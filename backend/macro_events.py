"""
시장 일정 (경제지표·금리 결정·실적 발표·만기·주요 행사)

출처 (모두 공식 일정 또는 확인된 발표만 사용, 추정 날짜는 넣지 않는다)
- 미국 FOMC: federalreserve.gov 회의 일정표
- 한국은행 금통위(기준금리): bok.or.kr 통화정책방향 결정회의 일정
- 한국은행 통계 공표일정: 소비자동향조사(소비자심리지수)·GDP 속보·생산자물가 등
- 미국 BEA: GDP·개인소득지출(PCE 물가)·무역수지
- 미국 BLS: CPI·고용보고서 — BLS가 서버 접속을 막아 공식 일정표에서 옮긴 값을 아래 표로 관리 (연 1회 갱신)
- 국내 실적 발표·IR: 한국거래소 KIND 기업설명회(IR) 일정
- 미국 대형주 실적: Nasdaq 실적 캘린더
- 옵션 만기일: 매월 둘째 목요일 (거래소 규칙)
- 주요 행사: 날짜를 확인한 행사만 아래 표로 관리
"""

import asyncio
import logging
import re
from datetime import date, datetime, timedelta, timezone

import httpx

import json

from kis_client import _cache_get, _cache_set, _redis
import dart

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

# BLS 공식 일정표에서 옮김 (https://www.bls.gov/schedule/news_release/cpi.htm, empsit.htm) — 미국 동부시각 08:30
BLS_RELEASES = [
    ("2026-11-06", "미국 10월 고용보고서", "비농업 고용·실업률"), ("2026-11-10", "미국 10월 소비자물가(CPI)", ""),
    ("2026-12-04", "미국 11월 고용보고서", "비농업 고용·실업률"), ("2026-12-10", "미국 11월 소비자물가(CPI)", ""),
    ("2027-01-08", "미국 12월 고용보고서", "비농업 고용·실업률"), ("2027-01-13", "미국 12월 소비자물가(CPI)", ""),
    ("2027-02-05", "미국 1월 고용보고서", "비농업 고용·실업률"), ("2027-02-11", "미국 1월 소비자물가(CPI)", ""),
    ("2027-03-05", "미국 2월 고용보고서", "비농업 고용·실업률"), ("2027-03-10", "미국 2월 소비자물가(CPI)", ""),
]
# 날짜를 확인한 주요 행사 (주최 측 공지·보도 기준)
EVENTS = [
    ("2026-10-14", "2026-10-16", "반도체대전 SEDEX 2026", "서울 코엑스 C·D홀 · 삼성전자·SK하이닉스 등 300개사"),
    ("2026-10-14", "2026-10-16", "한국전자전 KES 2026", "서울 코엑스 A·B홀"),
    ("2027-01-06", "2027-01-09", "CES 2027", "미국 라스베이거스"),
]
# 미국 대형주 영문명 → 한글
US_NAMES = {
    "AAPL": "애플", "MSFT": "마이크로소프트", "GOOGL": "알파벳(구글)", "GOOG": "알파벳(구글)", "AMZN": "아마존", "META": "메타",
    "NVDA": "엔비디아", "TSLA": "테슬라", "AVGO": "브로드컴", "TSM": "TSMC", "LLY": "일라이릴리", "V": "비자", "MA": "마스터카드",
    "JPM": "JP모건", "WMT": "월마트", "ORCL": "오라클", "NFLX": "넷플릭스", "AMD": "AMD", "ASML": "ASML", "COST": "코스트코",
    "XOM": "엑슨모빌", "UNH": "유나이티드헬스", "JNJ": "존슨앤드존슨", "PG": "P&G", "HD": "홈디포", "BAC": "뱅크오브아메리카",
    "KO": "코카콜라", "PLTR": "팔란티어", "MU": "마이크론", "INTC": "인텔", "QCOM": "퀄컴", "ARM": "ARM", "CRM": "세일즈포스",
    "IBM": "IBM", "GEV": "GE버노바", "GS": "골드만삭스", "MS": "모건스탠리", "WFC": "웰스파고", "C": "씨티그룹",
    "ABBV": "애브비", "MRK": "머크", "PEP": "펩시코", "CVX": "셰브론", "BRK.B": "버크셔해서웨이", "SAP": "SAP", "NVO": "노보노디스크",
    "TMUS": "T모바일", "CSCO": "시스코", "ADBE": "어도비", "UBER": "우버", "SHOP": "쇼피파이", "SPOT": "스포티파이", "AMAT": "어플라이드머티어리얼즈", "LRCX": "램리서치", "TXN": "텍사스인스트루먼트",
}


async def _get(url: str, **kw) -> httpx.Response | None:
    try:
        async with httpx.AsyncClient(timeout=15, headers=UA, follow_redirects=True) as client:
            return await (client.post(url, **kw) if "data" in kw else client.get(url, **kw))
    except Exception as e:
        logger.warning("[MACRO] %s 실패: %s", url, e)
        return None


def _text(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


# ── 미국 FOMC ──
async def _fomc() -> list[dict]:
    r = await _get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")
    if not r or r.status_code != 200:
        return []
    html = r.text
    mon = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                         "September", "October", "November", "December"], 1)}
    out = []
    for year in (datetime.now(KST).year, datetime.now(KST).year + 1):
        i = html.find(f"{year} FOMC Meetings")
        if i < 0:
            continue
        j = html.find(f"{year - 1} FOMC Meetings", i)
        seg = html[i: j if j > i else i + 40000]
        for m, d in re.findall(r"fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<", seg, re.S):
            mname = m.split("/")[-1].strip()
            day = re.findall(r"\d+", d)
            if mname not in mon or not day:
                continue
            us = date(year, mon[mname], int(day[-1]))      # 회의 마지막 날 = 금리 결정 발표 (미국 14:00 ET)
            kst = us + timedelta(days=1)
            out.append({"date": kst.isoformat(), "type": "rate", "title": "미국 FOMC 기준금리 결정",
                        "detail": f"미국 {us.month}/{us.day} 오후 2시 발표 · 한국 시각 새벽 3~4시" + (" · 경제전망 발표" if "*" in d else "")})
    return out


# ── 한국은행 기준금리(금통위) ──
async def _bok_rate() -> list[dict]:
    r = await _get("https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755")
    if not r or r.status_code != 200:
        return []
    year = datetime.now(KST).year
    out = []
    for mm, dd in re.findall(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*\([월화수목금]\)", _text(r.text)):
        try:
            d = date(year, int(mm), int(dd))
        except ValueError:
            continue
        out.append({"date": d.isoformat(), "type": "rate", "title": "한국은행 기준금리 결정 (금통위)", "detail": "통화정책방향 결정회의 · 총재 기자간담회"})
    return out


# ── 한국은행 통계 공표일정 ──
BOK_PICK = [
    (r"소비자동향조사", "소비자심리지수 발표", "한국은행 소비자동향조사"),
    (r"실질 국내총생산\(속보\)", "한국 GDP 속보치 발표", ""),
    (r"생산자물가지수", "한국 생산자물가지수 발표", ""),
    (r"수출입물가지수", "한국 수출입물가지수 발표", ""),
    (r"기업경기조사", "기업경기실사지수(BSI)·경제심리지수 발표", ""),
    (r"국제수지\(잠정\)", "한국 경상수지 발표", "국제수지(잠정)"),
]


async def _bok_stats() -> list[dict]:
    r = await _get("https://www.bok.or.kr/portal/stats/statsPublictSchdul/listCldr.do?menuNo=200775")
    if not r or r.status_code != 200:
        return []
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S):
        cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) < 3 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", cells[0]):
            continue
        for pat, title, extra in BOK_PICK:
            if re.search(pat, cells[2]):
                period = re.match(r"(\d{4}년 [\d/]+(?:월|분기))", cells[2])
                out.append({"date": cells[0], "type": "macro", "title": title,
                            "detail": " · ".join(x for x in [period.group(1) if period else "", f"{cells[1]} 공표", extra] if x)})
                break
    return out


# ── 미국 BEA ──
async def _bea() -> list[dict]:
    r = await _get("https://www.bea.gov/news/schedule")
    if not r or r.status_code != 200:
        return []
    mon = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                         "September", "October", "November", "December"], 1)}
    today = datetime.now(KST).date()
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S):
        t = _text(row)
        m = re.match(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b", t)
        if not m:
            continue
        d = date(today.year, mon[m.group(1)], int(m.group(2)))
        if d < today - timedelta(days=200):
            d = date(today.year + 1, d.month, d.day)
        if "GDP (Advance" in t:
            title = "미국 GDP 속보치 발표"
        elif "Personal Income and Outlays" in t:
            title = "미국 PCE 물가(개인소득·지출) 발표"
        elif "International Trade in Goods and Services" in t:
            title = "미국 무역수지 발표"
        else:
            continue
        out.append({"date": d.isoformat(), "type": "macro", "title": title, "detail": "미국 동부시각 08:30 (한국 시각 밤 9:30~10:30)"})
    return out


def _bls() -> list[dict]:
    return [{"date": d, "type": "macro", "title": t, "detail": " · ".join(x for x in [s, "미국 동부시각 08:30 (한국 밤 9:30~10:30)"] if x)}
            for d, t, s in BLS_RELEASES]


# ── 국내 실적 발표·IR (KIND) ──
# 주의: KIND는 클라우드 서버 IP를 차단해 Vercel에서는 403. 로컬 실행에서만 동작하며,
# 운영에서는 DART 공시(기업설명회 개최·잠정실적)로 대체해야 한다 (DART_API_KEY 필요).
async def _kind_ir(days: int) -> list[dict]:
    today = datetime.now(KST).date()
    out, seen = [], set()
    for page in range(1, 6):
        r = await _get("https://kind.krx.co.kr/corpgeneral/irschedule.do",
                       data={"method": "searchIRScheduleSub", "forward": "searchirschedule_sub", "currentPageSize": "100",
                             "pageIndex": str(page), "orderMode": "1", "orderStat": "A", "marketType": "",
                             "fromDate": today.isoformat(), "toDate": (today + timedelta(days=days)).isoformat(), "searchCorpName": ""},
                       headers={**UA, "Referer": "https://kind.krx.co.kr/corpgeneral/irschedule.do?method=searchIRScheduleMain"})
        if not r or r.status_code != 200:
            break
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S)
        got = 0
        for row in rows:
            c = [_text(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(c) < 6 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", c[4]):
                continue
            got += 1
            name, subject, place, d, tm = c[1], c[2], c[3], c[4], c[5]
            if not re.search(r"[가-힣]", subject):      # 영문 중복 안내는 제외
                continue
            key = (name, d)
            if key in seen:
                continue
            seen.add(key)
            earnings = bool(re.search(r"실적|Earnings|컨퍼런스콜|Conference Call", subject, re.I))
            out.append({"date": d, "type": "earnings" if earnings else "ir", "name": name,
                        "title": f"{name} {'실적 발표' if earnings else 'IR 설명회'}",
                        "detail": " · ".join(x for x in [subject[:60], tm if tm and tm != "--:--" else "", place[:30]] if x and x.strip("- "))})
        if got < 100:
            break
    return out


# ── 미국 대형주 실적 (Nasdaq) ──
async def _us_earnings(days: int, min_cap: float = 250e9) -> list[dict]:
    today = datetime.now(KST).date()
    sem = asyncio.Semaphore(15)

    async def one(d: date):
        if d.weekday() >= 5:
            return []
        async with sem:
            try:
                async with httpx.AsyncClient(timeout=15, headers={**UA, "Accept": "application/json",
                                                                  "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}) as client:
                    r = await client.get(f"https://api.nasdaq.com/api/calendar/earnings?date={d.isoformat()}")
                    rows = ((r.json() or {}).get("data") or {}).get("rows") or []
            except Exception:
                return []
        res, seen_names = [], set()
        for x in rows:
            try:
                cap = float(re.sub(r"[^\d.]", "", x.get("marketCap") or "") or 0)
            except ValueError:
                cap = 0
            sym = x.get("symbol", "")
            if cap < min_cap or x.get("name") in seen_names:
                continue
            seen_names.add(x.get("name"))
            when = {"time-after-hours": "장 마감 후 (한국 다음 날 새벽)", "time-pre-market": "장 시작 전 (한국 밤)"}.get(x.get("time"), "")
            res.append({"date": d.isoformat(), "type": "us_earnings", "title": f"{US_NAMES.get(sym, x.get('name', sym))} 실적 발표",
                        "detail": " · ".join(v for v in [f"미국 {sym}", when, f"시가총액 {cap / 1e12:.2f}조 달러" if cap >= 1e12 else ""] if v)})
        return res

    results = await asyncio.gather(*[one(today + timedelta(days=i)) for i in range(days + 1)])
    return [e for lst in results for e in lst]


# ── 규칙으로 정해지는 일정 ──
def _rules(days: int) -> list[dict]:
    today = datetime.now(KST).date()
    end = today + timedelta(days=days)
    out = []
    y, m = today.year, today.month
    while date(y, m, 1) <= end:
        first = date(y, m, 1)
        second_thu = first + timedelta(days=(3 - first.weekday()) % 7 + 7)
        quarterly = m in (3, 6, 9, 12)
        out.append({"date": second_thu.isoformat(), "type": "expiry",
                    "title": "선물·옵션 동시 만기일" if quarterly else "옵션 만기일",
                    "detail": "매월 둘째 목요일 (휴장일이면 앞당겨짐)" + (" · 분기 동시만기로 변동성 주의" if quarterly else "")})
        out.append({"date": first.isoformat(), "type": "macro", "title": f"한국 {m - 1 if m > 1 else 12}월 수출입동향 발표",
                    "detail": "산업통상자원부 · 매월 1일 오전"})
        m = m + 1 if m < 12 else 1
        y = y + 1 if m == 1 else y
    return out


def _events() -> list[dict]:
    out = []
    for s, e, title, detail in EVENTS:
        sd, ed = date.fromisoformat(s), date.fromisoformat(e)
        out.append({"date": s, "type": "event", "title": title,
                    "detail": f"{sd.month}/{sd.day}~{ed.month}/{ed.day} · {detail}" if s != e else detail})
    return out


async def fetch_macro(days_ahead: int = 60) -> list[dict]:
    """메모리 → 공유 저장소(Upstash, 3시간) → 새로 수집 순. 새로 수집은 10초 이상 걸릴 수 있어 공유해 둔다"""
    key = f"macro:{days_ahead}"
    cached = _cache_get(key, 3 * 3600)
    if cached:
        return cached
    rkey = f"drmarket:macro:v2:{days_ahead}:{datetime.now(KST).strftime('%Y%m%d')}:{'dart' if dart.enabled() else 'kind'}"
    shared = await _redis("GET", rkey)
    if shared:
        try:
            ev = json.loads(shared)
            _cache_set(key, ev)
            return ev
        except Exception:
            pass
    # 국내 실적·IR: DART 키가 있으면 DART(운영), 없으면 KIND(로컬에서만 동작)
    domestic = dart.fetch_ir_events(days_ahead) if dart.enabled() else _kind_ir(days_ahead)
    parts = await asyncio.gather(_fomc(), _bok_rate(), _bok_stats(), _bea(), domestic, _us_earnings(min(days_ahead, 45)),
                                 return_exceptions=True)
    ev = [e for p in parts if isinstance(p, list) for e in p] + _bls() + _rules(days_ahead) + _events()
    today = datetime.now(KST).date().isoformat()
    limit = (datetime.now(KST).date() + timedelta(days=days_ahead)).isoformat()
    ev = [e for e in ev if today <= e["date"] <= limit]
    for e in ev:
        e["scope"] = {"rate": "economy", "macro": "economy", "expiry": "economy", "event": "economy",
                      "earnings": "earnings", "ir": "earnings", "us_earnings": "earnings"}.get(e["type"], "market")
    if ev:
        _cache_set(key, ev)
        await _redis("SET", rkey, json.dumps(ev, ensure_ascii=False), "EX", str(3 * 3600))
    return ev
