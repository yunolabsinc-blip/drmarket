"""
익명 사용 통계 · 의견 보내기 (Upstash Redis 저장)

- 개인을 식별하는 정보(이름·연락처·IP·기기 정보)는 저장하지 않는다.
- 방문자 수는 브라우저가 만든 무작위 ID로 셈하되, ID 자체는 저장하지 않고
  Redis HyperLogLog(근사 카운터)에만 넣는다. 화면별 조회 수·체류 시간·주요 기능 사용 횟수만 날짜별로 집계.
- 의견은 본문과 (본인이 적은 경우) 연락처만 저장. IP는 남용 방지를 위해 1시간짜리 해시 카운터로만 쓴다.
"""

import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

_URL = os.getenv("KV_REST_API_URL") or os.getenv("UPSTASH_REDIS_REST_URL") or ""
_TOKEN = os.getenv("KV_REST_API_TOKEN") or os.getenv("UPSTASH_REDIS_REST_TOKEN") or ""
PREFIX = "drmarket:stats"
KEEP_DAYS = 120

# 집계를 허용하는 화면·기능 이름 (임의 문자열이 저장되지 않도록 제한)
PAGES = {"home", "themes", "theme", "rank", "market", "market/news", "market/calendar", "watch", "stock", "index"}
EVENTS = {
    "search", "orderbook", "news_open", "news_link", "stock_chip", "ticker_open", "chart_period",
    "theme_open", "fav_add", "memo_save", "calendar_month", "install", "feedback",
}


def enabled() -> bool:
    return bool(_URL and _TOKEN)


async def _pipeline(cmds: list[list[str]]):
    if not enabled() or not cmds:
        return None
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.post(f"{_URL}/pipeline", json=cmds, headers={"Authorization": f"Bearer {_TOKEN}"})
            return [r.get("result") for r in resp.json()]
    except Exception as e:
        logger.warning("[STATS] redis 실패: %s", e)
        return None


def _day(offset: int = 0) -> str:
    return (datetime.now(KST) - timedelta(days=offset)).strftime("%Y%m%d")


async def record(visitor: str, pages: dict, events: dict) -> bool:
    """pages: {화면: [조회수, 체류초]}, events: {기능: 횟수}"""
    day = _day()
    ttl = str(KEEP_DAYS * 86400)
    cmds: list[list[str]] = []
    if re.fullmatch(r"[A-Za-z0-9-]{8,64}", visitor or ""):
        cmds += [["PFADD", f"{PREFIX}:uv:{day}", visitor], ["EXPIRE", f"{PREFIX}:uv:{day}", ttl]]
    for page, (views, secs) in list(pages.items())[:20]:
        if page not in PAGES:
            continue
        views = max(0, min(int(views), 200))
        secs = max(0, min(int(secs), 4 * 3600))
        if views:
            cmds.append(["HINCRBY", f"{PREFIX}:views:{day}", page, str(views)])
        if secs:
            cmds.append(["HINCRBY", f"{PREFIX}:secs:{day}", page, str(secs)])
    for ev, n in list(events.items())[:20]:
        if ev in EVENTS:
            cmds.append(["HINCRBY", f"{PREFIX}:events:{day}", ev, str(max(0, min(int(n), 500)))])
    for k in ("views", "secs", "events"):
        cmds.append(["EXPIRE", f"{PREFIX}:{k}:{day}", ttl])
    return (await _pipeline(cmds)) is not None


async def add_feedback(text: str, contact: str, page: str, ip: str) -> tuple[bool, str]:
    text = (text or "").strip()[:1000]
    contact = (contact or "").strip()[:100]
    if len(text) < 2:
        return False, "내용을 입력해 주세요."
    # 남용 방지: 같은 IP에서 1시간에 10건까지 (IP는 해시로만, 1시간 뒤 자동 삭제)
    ip_key = f"{PREFIX}:fbrate:{hashlib.sha256((ip or '').encode()).hexdigest()[:16]}"
    res = await _pipeline([["INCR", ip_key], ["EXPIRE", ip_key, "3600"]])
    if res and int(res[0] or 0) > 10:
        return False, "잠시 후 다시 보내 주세요."
    item = json.dumps({"t": datetime.now(KST).isoformat(timespec="seconds"), "text": text,
                       "contact": contact, "page": page if page in PAGES else ""}, ensure_ascii=False)
    ok = await _pipeline([["LPUSH", f"{PREFIX}:feedback", item], ["LTRIM", f"{PREFIX}:feedback", "0", "999"]])
    return (ok is not None), ("" if ok is not None else "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.")


async def summary(days: int = 14) -> dict:
    days = max(1, min(days, KEEP_DAYS))
    dates = [_day(i) for i in range(days)]
    cmds = []
    for d in dates:
        cmds += [["PFCOUNT", f"{PREFIX}:uv:{d}"], ["HGETALL", f"{PREFIX}:views:{d}"],
                 ["HGETALL", f"{PREFIX}:secs:{d}"], ["HGETALL", f"{PREFIX}:events:{d}"]]
    cmds.append(["PFCOUNT", *[f"{PREFIX}:uv:{d}" for d in dates]])
    cmds.append(["LRANGE", f"{PREFIX}:feedback", "0", "199"])
    res = await _pipeline(cmds)
    if res is None:
        return {"enabled": enabled(), "error": "통계 저장소에 연결하지 못했습니다."}

    def h(lst):   # HGETALL 결과 [k1, v1, k2, v2 ...] → dict
        lst = lst or []
        return {lst[i]: int(lst[i + 1]) for i in range(0, len(lst) - 1, 2)}

    daily, totals_v, totals_s, totals_e = [], {}, {}, {}
    for i, d in enumerate(dates):
        uv, views, secs, events = res[i * 4], h(res[i * 4 + 1]), h(res[i * 4 + 2]), h(res[i * 4 + 3])
        daily.append({"date": f"{d[:4]}-{d[4:6]}-{d[6:]}", "visitors": int(uv or 0),
                      "views": sum(views.values()), "minutes": round(sum(secs.values()) / 60)})
        for k, v in views.items():
            totals_v[k] = totals_v.get(k, 0) + v
        for k, v in secs.items():
            totals_s[k] = totals_s.get(k, 0) + v
        for k, v in events.items():
            totals_e[k] = totals_e.get(k, 0) + v
    pages = sorted(({"page": p, "views": totals_v.get(p, 0), "minutes": round(totals_s.get(p, 0) / 60),
                     "avg_sec": round(totals_s.get(p, 0) / totals_v[p]) if totals_v.get(p) else 0}
                    for p in set(totals_v) | set(totals_s)), key=lambda x: -x["views"])
    feedback = []
    for raw in res[-1] or []:
        try:
            feedback.append(json.loads(raw))
        except Exception:
            pass
    return {"enabled": True, "days": days, "unique_visitors": int(res[-2] or 0), "daily": daily,
            "pages": pages, "events": dict(sorted(totals_e.items(), key=lambda x: -x[1])), "feedback": feedback}


# ──────────────────────────────────────────────
# 관리자 로그인 잠금 (비밀번호 대입 방지)
# ──────────────────────────────────────────────
_FAIL_LIMIT, _LOCK_SEC = 5, 900          # 같은 곳: 5번 틀리면 15분
_GLOBAL_LIMIT, _GLOBAL_SEC = 50, 3600    # 전체: 1시간에 50번 틀리면 1시간


def _ipkey(ip: str) -> str:
    return f"{PREFIX}:adminfail:{hashlib.sha256((ip or '').encode()).hexdigest()[:16]}"


async def admin_locked(ip: str) -> tuple[bool, str]:
    res = await _pipeline([["GET", _ipkey(ip)], ["GET", f"{PREFIX}:adminfail:all"]])
    if res is None:
        return True, "잠시 후 다시 시도해 주세요."   # 저장소에 못 붙으면 안전하게 거부
    mine, total = int(res[0] or 0), int(res[1] or 0)
    if mine >= _FAIL_LIMIT:
        return True, "비밀번호를 여러 번 틀려 15분간 잠겼습니다. 잠시 후 다시 시도해 주세요."
    if total >= _GLOBAL_LIMIT:
        return True, "로그인 시도가 너무 많아 잠시 막혔습니다. 1시간 뒤 다시 시도해 주세요."
    return False, ""


async def admin_fail(ip: str) -> int:
    res = await _pipeline([["INCR", _ipkey(ip)], ["EXPIRE", _ipkey(ip), str(_LOCK_SEC)],
                           ["INCR", f"{PREFIX}:adminfail:all"], ["EXPIRE", f"{PREFIX}:adminfail:all", str(_GLOBAL_SEC), "NX"]])
    mine = int((res or [0])[0] or 0)
    return max(0, _FAIL_LIMIT - mine)


async def admin_ok(ip: str):
    await _pipeline([["DEL", _ipkey(ip)]])
