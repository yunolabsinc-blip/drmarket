"""
상한가 기록 · 시장 일정 (한국예탁결제원 정보 — 한국투자증권 Open API)
"""

import asyncio
from datetime import datetime, timedelta

from kis_client import _cache_get, _cache_set, _get, _num, fetch_daily_chart


async def fetch_limit_ups(code: str, years: int = 2) -> dict:
    """최근 N년 일봉에서 상한가(등락 부호 1)·하한가(부호 4) 마감일을 센다"""
    key = f"limitups:{code}:{years}"
    cached = _cache_get(key, 3600)
    if cached:
        return cached
    rows = await fetch_daily_chart(code, "D", pages=3 * years)
    since = (datetime.now() - timedelta(days=365 * years)).strftime("%Y-%m-%d")
    rows = [r for r in rows if r["t"] >= since]
    prev = None
    ups, downs = [], []
    for r in rows:
        rate = round((r["c"] - prev) / prev * 100, 2) if prev else None
        if r.get("s") == "1":
            ups.append({"t": r["t"], "c": r["c"], "rate": rate})
        elif r.get("s") == "4":
            downs.append({"t": r["t"], "c": r["c"], "rate": rate})
        prev = r["c"]
    result = {"code": code, "years": years, "since": since, "days": len(rows),
              "up_count": len(ups), "down_count": len(downs), "ups": ups[::-1], "downs": downs[::-1]}
    if rows:
        _cache_set(key, result)
    return result


def _d8(v: str) -> str:
    """'20261006' / '2026/10/06' → '2026-10-06'"""
    v = (v or "").strip().replace("/", "").replace("-", "")[:8]
    return f"{v[:4]}-{v[4:6]}-{v[6:]}" if len(v) == 8 and v.isdigit() else ""


def _s(o: dict, k: str) -> str:
    return (o.get(k) or "").strip()


async def fetch_calendar(days_ahead: int = 60) -> list[dict]:
    """휴장일 · 공모주 청약/신규상장 · 배당 기준일 · 주주총회 · 무상증자 · 감자 · 합병/분할"""
    key = f"calendar:{days_ahead}"
    cached = _cache_get(key, 1800)
    if cached:
        return cached
    now = datetime.utcnow() + timedelta(hours=9)
    f_past = (now - timedelta(days=14)).strftime("%Y%m%d")   # 공모주는 청약 시작일 기준으로 등록되므로 과거도 포함
    f_today = now.strftime("%Y%m%d")
    t_dt = (now + timedelta(days=days_ahead)).strftime("%Y%m%d")

    async def ksd(path: str, tr: str, extra: dict | None = None, f_dt: str = f_today):
        data = await _get(f"/uapi/domestic-stock/v1/ksdinfo/{path}",
                          {"SHT_CD": "", "CTS": "", "F_DT": f_dt, "T_DT": t_dt, **(extra or {})}, tr)
        return (data or {}).get("output1", []) or []

    async def holidays():
        out = []
        for n in range(0, days_ahead + 1, 24):   # 휴장일 조회는 기준일부터 약 24일씩
            base = (now + timedelta(days=n)).strftime("%Y%m%d")
            data = await _get("/uapi/domestic-stock/v1/quotations/chk-holiday",
                              {"BASS_DT": base, "CTX_AREA_NK": "", "CTX_AREA_FK": ""}, "CTCA0903R")
            out += (data or {}).get("output", []) or []
        return out

    hol, ipo, div, meet, bonus, capdec, merge = await asyncio.gather(
        holidays(),
        ksd("pub-offer", "HHKDB669108C0", f_dt=f_past),
        ksd("dividend", "HHKDB669102C0", {"GB1": "0", "HIGH_GB": ""}),
        ksd("sharehld-meet", "HHKDB669111C0"),
        ksd("bonus-issue", "HHKDB669101C0"),
        ksd("cap-dcrs", "HHKDB669106C0"),
        ksd("merger-split", "HHKDB669104C0", f_dt=f_past),
    )

    ev: list[dict] = []
    seen_h = set()
    for h in hol:
        d = h.get("bass_dt", "")
        if d in seen_h or h.get("opnd_yn") == "Y" or h.get("wday_dvsn_cd") in ("01", "07"):
            continue
        seen_h.add(d)
        ev.append({"date": _d8(d), "type": "holiday", "title": "증시 휴장"})

    for o in ipo:
        name, code = _s(o, "isin_name"), _s(o, "sht_cd")
        price = _num(o.get("fix_subscr_pri"), int)
        detail = f"공모가 {price:,}원 · 주관 {_s(o, 'lead_mgr')}" if price else _s(o, "lead_mgr")
        rng = _s(o, "subscr_dt").split("~")
        start, end = _d8(rng[0]), _d8(rng[1]) if len(rng) > 1 else ""
        today_s = now.strftime("%Y-%m-%d")
        if start:
            ongoing = start < today_s <= (end or start)
            ev.append({"date": today_s if ongoing else start, "type": "ipo", "code": code,
                       "title": f"{name} 공모주 청약" + (" (진행 중)" if ongoing else ""),
                       "detail": f"{start[5:]} ~ {end[5:]} · {detail}" if end else detail})
        if _d8(o.get("list_dt")):
            ev.append({"date": _d8(o.get("list_dt")), "type": "listing", "code": code, "title": f"{name} 신규 상장", "detail": detail})

    for o in div:
        if "기업인수목적" in _s(o, "isin_name"):
            continue
        amt = _num(o.get("per_sto_divi_amt"), int)
        ev.append({"date": _d8(o.get("record_date")), "type": "dividend", "code": _s(o, "sht_cd"),
                   "title": f"{_s(o, 'isin_name')} {_s(o, 'divi_kind')}배당 기준일",
                   "detail": f"주당 {amt:,}원" if amt else "배당금 미정"})

    for o in meet:
        ev.append({"date": _d8(o.get("gen_meet_dt")), "type": "meeting", "code": _s(o, "sht_cd"),
                   "title": f"{_s(o, 'isin_name')} {_s(o, 'gen_meet_type')}", "detail": _s(o, "agenda")})

    for o in bonus:
        ev.append({"date": _d8(o.get("record_date")), "type": "bonus", "code": _s(o, "sht_cd"),
                   "title": f"{_s(o, 'isin_name')} 무상증자 기준일",
                   "detail": f"1주당 {_num(o.get('fix_rate')) / 100:.2f}주 배정"})

    for o in capdec:
        stop = _s(o, "td_stop_dt").split("~")[0].strip()
        ev.append({"date": _d8(stop) or _d8(o.get("record_date")), "type": "capdec", "code": _s(o, "sht_cd"),
                   "title": f"{_s(o, 'isin_name')} {_s(o, 'reduce_cap_type') or '감자'}",
                   "detail": f"거래정지 {_s(o, 'td_stop_dt')}" if stop else f"기준일 {_d8(o.get('record_date'))}"})

    for o in merge:
        stop = _s(o, "td_stop_dt").split("~")[0].strip()
        a, b = _s(o, "opp_cust_nm"), _s(o, "cust_nm")
        ev.append({"date": _d8(stop) or _d8(o.get("record_date")), "type": "merger", "code": _s(o, "sht_cd"),
                   "title": f"{a} {_s(o, 'merge_type')}" + (f" ({b})" if b and b != a else ""),
                   "detail": f"거래정지 {_s(o, 'td_stop_dt')}" if stop else f"기준일 {_d8(o.get('record_date'))}"})

    today = now.strftime("%Y-%m-%d")
    limit = (now + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    ev = [e for e in ev if e["date"] and today <= e["date"] <= limit]
    # scope: market=시장 전체 일정(휴장·공모·상장), stock=개별 종목 일정
    for e in ev:
        e["scope"] = "market" if e["type"] in ("holiday", "ipo", "listing") else "stock"
    order = {"holiday": 0, "ipo": 1, "listing": 2, "dividend": 3, "bonus": 4, "meeting": 5, "capdec": 6, "merger": 7}
    ev.sort(key=lambda e: (e["date"], order.get(e["type"], 9), e["title"]))
    if ev:
        _cache_set(key, ev)
    return ev


async def fetch_stock_events(code: str, days_ahead: int = 90) -> list[dict]:
    """특정 종목의 예정 일정 (예탁원 정보 종목 조회)"""
    key = f"events:{code}:{days_ahead}"
    cached = _cache_get(key, 1800)
    if cached:
        return cached
    now = datetime.utcnow() + timedelta(hours=9)
    f_dt, t_dt = now.strftime("%Y%m%d"), (now + timedelta(days=days_ahead)).strftime("%Y%m%d")

    async def ksd(path: str, tr: str, extra: dict | None = None):
        data = await _get(f"/uapi/domestic-stock/v1/ksdinfo/{path}",
                          {"SHT_CD": code, "CTS": "", "F_DT": f_dt, "T_DT": t_dt, **(extra or {})}, tr)
        return (data or {}).get("output1", []) or []

    div, meet, bonus, capdec, merge = await asyncio.gather(
        ksd("dividend", "HHKDB669102C0", {"GB1": "0", "HIGH_GB": ""}),
        ksd("sharehld-meet", "HHKDB669111C0"),
        ksd("bonus-issue", "HHKDB669101C0"),
        ksd("cap-dcrs", "HHKDB669106C0"),
        ksd("merger-split", "HHKDB669104C0"),
    )
    ev: list[dict] = []
    for o in div:
        amt = _num(o.get("per_sto_divi_amt"), int)
        ev.append({"date": _d8(o.get("record_date")), "type": "dividend", "title": f"{_s(o, 'divi_kind')}배당 기준일",
                   "detail": f"주당 {amt:,}원" if amt else "배당금 미정"})
    for o in meet:
        ev.append({"date": _d8(o.get("gen_meet_dt")), "type": "meeting", "title": _s(o, "gen_meet_type") or "주주총회", "detail": _s(o, "agenda")})
    for o in bonus:
        ev.append({"date": _d8(o.get("record_date")), "type": "bonus", "title": "무상증자 기준일",
                   "detail": f"1주당 {_num(o.get('fix_rate')) / 100:.2f}주 배정"})
    for o in capdec:
        stop = _s(o, "td_stop_dt").split("~")[0].strip()
        ev.append({"date": _d8(stop) or _d8(o.get("record_date")), "type": "capdec", "title": _s(o, "reduce_cap_type") or "감자",
                   "detail": f"거래정지 {_s(o, 'td_stop_dt')}" if stop else f"기준일 {_d8(o.get('record_date'))}"})
    for o in merge:
        stop = _s(o, "td_stop_dt").split("~")[0].strip()
        ev.append({"date": _d8(stop) or _d8(o.get("record_date")), "type": "merger", "title": _s(o, "merge_type") or "합병·분할",
                   "detail": f"거래정지 {_s(o, 'td_stop_dt')}" if stop else f"기준일 {_d8(o.get('record_date'))}"})
    today = now.strftime("%Y-%m-%d")
    ev = sorted([e for e in ev if e["date"] and e["date"] >= today], key=lambda e: e["date"])
    _cache_set(key, ev)
    return ev
