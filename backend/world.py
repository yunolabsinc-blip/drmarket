"""해외 지수·선물·환율·유가 (네이버 증권, 지연 시세 — 실시간 아님)

시장종합 지수 카드용. 항목마다 현재값(basic)과 최근 10일 종가(미니 차트)를 받는다.
받지 못한 항목은 빠지고, 전부 실패하면 빈 목록 → 호출한 쪽이 한투 API로 대신한다.
"""
import asyncio
import time

import httpx

BASE = "https://api.stock.naver.com"
# (종류, 코드, 이름, 장 시간 구분) — 종류: index 지수 · futures 선물 · energy 원자재 · exchange 환율
ITEMS = [
    ("index", ".IXIC", "나스닥", "us"),
    ("index", ".INX", "S&P 500", "us"),
    ("futures", "NQcv1", "나스닥 100 선물", "fut"),
    ("futures", "EScv1", "S&P 500 선물", "fut"),
    ("index", ".DJI", "다우존스", "us"),
    ("index", ".NDX", "나스닥 100", "us"),
    ("index", ".SOX", "필라델피아 반도체", "us"),
    ("exchange", "FX_USDKRW", "원/달러 환율", "fx"),
    ("energy", "CLcv1", "WTI", "fut"),
]
_cache: dict = {"at": 0.0, "items": []}
_client: httpx.AsyncClient | None = None


def _num(v) -> float:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def _paths(kind: str, code: str) -> tuple[str, str]:
    if kind in ("index", "futures"):
        return f"/{kind}/{code}/basic", f"/{kind}/{code}/price?page=1&pageSize=10"
    return f"/marketindex/{kind}/{code}", f"/marketindex/{kind}/{code}/prices?page=1&pageSize=10"


async def _get(path: str):
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=5, headers={"User-Agent": "Mozilla/5.0"})
    r = await _client.get(BASE + path)
    r.raise_for_status()
    return r.json()


async def _item(kind: str, code: str, name: str, market: str) -> dict | None:
    basic_path, hist_path = _paths(kind, code)
    try:
        basic, hist = await asyncio.gather(_get(basic_path), _get(hist_path))
    except Exception:
        return None
    b = basic.get("exchangeInfo", basic) if kind == "exchange" else basic
    value = _num(b.get("closePriceRaw") or b.get("calcPrice") or b.get("closePrice"))
    if value <= 0:
        return None
    change = _num(b.get("compareToPreviousClosePriceRaw") or b.get("compareToPreviousClosePrice") or b.get("fluctuations"))
    rate = _num(b.get("fluctuationsRatioRaw") or b.get("fluctuationsRatio"))
    rows = hist if isinstance(hist, list) else []
    spark = [_num(r.get("closePrice")) for r in reversed(rows[:10]) if _num(r.get("closePrice")) > 0]
    traded = (b.get("localTradedAt") or (rows[0].get("localTradedAt") if rows else "") or "")[:10]
    status = b.get("marketStatus")
    return {
        "code": code, "name": name, "market": market, "source": "naver",
        "value": value, "change": round(change, 2), "changeRate": round(rate, 2),
        "date": f"{traded[5:7]}/{traded[8:10]}" if len(traded) == 10 else "",
        "spark": spark,
        # 네이버가 알려 주는 장 상태 (환율은 없음 → 앱이 시간으로 판단)
        "open": status == "OPEN" if status in ("OPEN", "CLOSE") and kind != "exchange" else None,
        "delay": b.get("delayTimeName") or "",
        "periods": ["D", "W", "M", "Y"] if kind in ("index", "futures") else ["D"],   # 누르면 볼 수 있는 차트 기간
    }


async def fetch_world() -> list[dict]:
    """60초 동안은 받아 둔 것을 그대로 준다"""
    if time.time() - _cache["at"] < 60 and _cache["items"]:
        return _cache["items"]
    out = await asyncio.gather(*[_item(*it) for it in ITEMS])
    items = [x for x in out if x]
    if items:
        _cache.update(at=time.time(), items=items)
    return items or _cache["items"]


_CANDLE = {"D": "dayCandle", "W": "weekCandle", "M": "monthCandle", "Y": "yearCandle"}
_chart_cache: dict = {}


async def fetch_world_chart(code: str, period: str = "D") -> list[dict]:
    """지수·선물은 일·주·월·년봉, 환율·유가는 최근 약 6개월 일봉(네이버가 기간 차트를 주지 않음)"""
    item = next((it for it in ITEMS if it[1] == code), None)
    if not item:
        return []
    kind = item[0]
    period = period if period in _CANDLE and kind in ("index", "futures") else "D"
    key = (code, period)
    hit = _chart_cache.get(key)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    try:
        if kind in ("index", "futures"):
            d = await _get(f"/chart/foreign/{kind}/{code}?periodType={_CANDLE[period]}")
            rows = [(r.get("localDate", ""), r) for r in d.get("priceInfos", [])]
            candles = [{"t": f"{t[:4]}-{t[4:6]}-{t[6:8]}", "o": _num(r.get("openPrice")), "h": _num(r.get("highPrice")),
                        "l": _num(r.get("lowPrice")), "c": _num(r.get("closePrice")), "v": _num(r.get("accumulatedTradingVolume"))}
                       for t, r in rows if len(t) == 8 and _num(r.get("closePrice")) > 0]
        else:
            pages = await asyncio.gather(*[_get(f"/marketindex/{kind}/{code}/prices?page={n}&pageSize=60") for n in (1, 2, 3)])
            seen = {}
            for page in pages:
                for r in page if isinstance(page, list) else []:
                    t, c = (r.get("localTradedAt") or "")[:10], _num(r.get("closePrice"))
                    if len(t) == 10 and c > 0:
                        o, h, l = _num(r.get("openPrice")) or c, _num(r.get("highPrice")) or c, _num(r.get("lowPrice")) or c
                        seen[t] = {"t": t, "o": o, "h": max(h, o, c), "l": min(l, o, c), "c": c, "v": 0}
            candles = [seen[t] for t in sorted(seen)]
    except Exception:
        return hit[1] if hit else []
    if candles:
        _chart_cache[key] = (time.time(), candles)
    return candles
