"""
금융감독원 DART 공시로 국내 실적 발표·IR 일정 만들기 (DART_API_KEY 필요)

- 거래소 공시(pblntf_ty=I) 목록에서 "기업설명회(IR)개최"와 "결산실적공시예고"를 고른다.
- 공시 본문(document.xml, zip)에서 개최 일시·예정일과 목적을 읽는다.
- 본문 해석 결과는 공시번호별로 공유 저장소(Upstash)에 30일 보관해 같은 문서를 다시 받지 않는다.
"""

import asyncio
import io
import json
import logging
import os
import re
import zipfile
from datetime import date, datetime, timedelta, timezone

import httpx

from kis_client import _cache_get, _cache_set, _redis

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))
BASE = "https://opendart.fss.or.kr/api"
KEY = os.getenv("DART_API_KEY", "").strip()

TARGETS = [
    (re.compile(r"기업설명회\(IR\)\s*개최"), "ir"),
    (re.compile(r"결산실적공시\s*예고"), "earnings"),
]


def enabled() -> bool:
    return len(KEY) >= 20


async def _list(client: httpx.AsyncClient, bgn: str, end: str) -> list[dict]:
    """거래소 공시 목록 (최대 30페이지)"""
    out = []
    for page in range(1, 31):
        try:
            r = await client.get(f"{BASE}/list.json", params={
                "crtfc_key": KEY, "bgn_de": bgn, "end_de": end, "pblntf_ty": "I",
                "page_no": page, "page_count": 100,
            })
            d = r.json()
        except Exception as e:
            logger.warning("[DART] 목록 실패: %s", e)
            break
        if d.get("status") != "000":
            if d.get("status") != "013":   # 013 = 조회 결과 없음
                logger.warning("[DART] 목록 오류 %s %s", d.get("status"), d.get("message"))
            break
        out += d.get("list", [])
        if page >= int(d.get("total_page", 1)):
            break
    return out


def _doc_text(raw: bytes) -> str:
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        parts = []
        for n in z.namelist():
            b = z.read(n)
            for enc in ("utf-8", "euc-kr", "cp949"):
                try:
                    parts.append(b.decode(enc))
                    break
                except UnicodeDecodeError:
                    continue
        text = " ".join(parts)
    except zipfile.BadZipFile:
        text = raw.decode("utf-8", "ignore")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text)


_DATE_PATTERNS = [
    re.compile(r"(20\d\d)\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})"),
]


def _first_date(seg: str) -> date | None:
    for p in _DATE_PATTERNS:
        m = p.search(seg)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                continue
    return None


# 공시 서식의 항목 번호 ("3. 개최방법", "4.후원기관") 에서 값을 끊는다
_NEXT_ITEM = re.compile(r"\s\d{1,2}\s*[.)]\s*[가-힣]")


def _field(text: str, labels: str, width: int = 120) -> str:
    m = re.search(rf"(?:{labels})\s*[:：]?\s*(.{{0,{width}}})", text)
    if not m:
        return ""
    v = m.group(1)
    cut = _NEXT_ITEM.search(" " + v)
    if cut:
        v = (" " + v)[: cut.start()]
    return v.strip(" -:·")


def _parse(kind: str, text: str) -> dict | None:
    """본문에서 일자·시간·목적·방법을 뽑는다"""
    if kind == "ir":
        when = _field(text, r"개최\s*일시|일\s*시|일자", 60)
        d = _first_date(when)
        if not d:
            return None
        tm = re.search(r"(\d{1,2})\s*[:시]\s*(\d{2})?", when[when.find(str(d.day)) + 1:] if when else "")
        hhmm = f"{int(tm.group(1)):02d}:{tm.group(2) or '00'}" if tm and 0 <= int(tm.group(1)) <= 23 else ""
        purpose = _field(text, r"개최\s*목적|목\s*적", 80)
        method = _field(text, r"개최\s*방법|실시\s*방법|방\s*법", 40)
        return {"date": d.isoformat(), "time": hhmm, "purpose": purpose[:60], "place": method[:30]}
    # 결산실적공시 예고: 예정일
    when = _field(text, r"공시\s*예정일|예정\s*일자|예정\s*일", 40)
    d = _first_date(when) or _first_date(text)
    if not d:
        return None
    period = re.search(r"(20\d\d년\s*\d\s*분기|20\d\d년\s*(?:연간|반기|결산)|\d\s*분기)", text)
    return {"date": d.isoformat(), "time": "", "purpose": (period.group(1) + " 실적 공시 예정") if period else "실적 공시 예정", "place": ""}


async def _parse_doc(client: httpx.AsyncClient, rcept_no: str, kind: str) -> dict | None:
    rkey = f"drmarket:dart:doc:v2:{rcept_no}"   # 해석 방식이 바뀌면 v 번호를 올린다
    cached = await _redis("GET", rkey)
    if cached:
        try:
            v = json.loads(cached)
            return v or None
        except Exception:
            pass
    try:
        r = await client.get(f"{BASE}/document.xml", params={"crtfc_key": KEY, "rcept_no": rcept_no})
        parsed = _parse(kind, _doc_text(r.content)) if r.status_code == 200 else None
    except Exception as e:
        logger.warning("[DART] 문서 실패 %s: %s", rcept_no, e)
        return None
    await _redis("SET", rkey, json.dumps(parsed or {}, ensure_ascii=False), "EX", str(30 * 86400))
    return parsed


async def fetch_ir_events(days_ahead: int = 60) -> list[dict]:
    """앞으로 days_ahead 일 안에 열리는 IR·실적 발표 (최근 45일 안에 나온 안내 공시 기준)"""
    if not enabled():
        return []
    key = f"dart_ir:{days_ahead}"
    cached = _cache_get(key, 6 * 3600)
    if cached is not None:
        return cached
    today = datetime.now(KST).date()
    async with httpx.AsyncClient(timeout=20) as client:
        items = await _list(client, (today - timedelta(days=45)).strftime("%Y%m%d"), today.strftime("%Y%m%d"))
        picked = []
        for it in items:
            for pat, kind in TARGETS:
                if pat.search(it.get("report_nm", "")):
                    picked.append((it, kind))
                    break
        sem = asyncio.Semaphore(8)

        async def one(it, kind):
            async with sem:
                return it, kind, await _parse_doc(client, it["rcept_no"], kind)

        results = await asyncio.gather(*[one(it, k) for it, k in picked])
    out, seen = [], set()
    limit = today + timedelta(days=days_ahead)
    for it, kind, p in results:
        if not p:
            continue
        d = date.fromisoformat(p["date"])
        if not (today <= d <= limit):
            continue
        name = it.get("corp_name", "").strip()
        k = (name, p["date"], kind)
        if k in seen:
            continue
        seen.add(k)
        earnings = kind == "earnings" or bool(re.search(r"실적|경영성과|Earnings", p["purpose"], re.I))
        out.append({
            "date": p["date"], "type": "earnings" if earnings else "ir", "name": name,
            "code": it.get("stock_code", "").strip(),
            "title": f"{name} {'실적 발표' if earnings else 'IR 설명회'}",
            "detail": " · ".join(x for x in [p["purpose"], p["time"], p["place"]] if x),
            "link": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={it['rcept_no']}",
        })
    _cache_set(key, out)
    return out
