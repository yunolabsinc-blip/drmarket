"""
전 종목 순위 (거래대금·거래량·상승률·하락률)

한국투자증권 순위 API는 한 번에 30종목까지만 주고 ETF·ETN이 섞여 있어, 주식만 남기면 열몇 개로 줄어든다.
그래서 주식 전체 목록(stock_master, 3시간마다 갱신)을 관심종목 멀티 시세(30종목/1회)로 한 바퀴 돌아
통합 시세(KRX+넥스트레이드) 기준으로 직접 순위를 매긴다.

- 한 바퀴 ≈ 90회 호출이라, 결과를 공유 저장소(Upstash)에 두고 모든 서버 인스턴스가 같이 쓴다.
- 장중에는 15초가 지나면 한 인스턴스만(잠금) 새로 돌고, 나머지는 직전 결과를 바로 돌려준다.
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import httpx

import kis_client as kis
import stock_master

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))
STOCKS_URL = os.getenv("STOCKS_URL", "https://yunolabsinc-blip.github.io/drmarket/stocks.json")
TOP_N = 100
RKEY = "drmarket:ranking:v1"
LOCK = "drmarket:ranking:lock"

_stocks: dict = {"at": 0.0, "list": []}
_local: dict = {"at": 0.0, "data": None}
_sweep_lock = asyncio.Lock()


def _max_age() -> int:
    """장 시간(평일 08:00~20:00, 통합 시세)에는 15초, 그 밖에는 10분"""
    now = datetime.now(KST)
    if now.weekday() < 5 and 8 <= now.hour < 20:
        return 15
    return 600


async def _stock_list() -> list[list]:
    listed = await stock_master.get_stocks()
    if listed:
        return listed
    # 종목 마스터를 못 받으면 사이트에 배포된 목록으로
    if _stocks["list"] and time.time() - _stocks["at"] < 6 * 3600:
        return _stocks["list"]
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(STOCKS_URL)
            data = r.json()
        if isinstance(data, list) and len(data) > 1000:
            _stocks.update(at=time.time(), list=data)
    except Exception as e:
        logger.warning("[RANK] 종목 목록 실패: %s", e)
    return _stocks["list"]


async def _quote_chunk(chunk: list[list], out: dict):
    params = {}
    for n, (code, _name, _mkt) in enumerate(chunk, 1):
        params[f"FID_COND_MRKT_DIV_CODE_{n}"] = kis.KIS_MARKET
        params[f"FID_INPUT_ISCD_{n}"] = code
    data = await kis._get("/uapi/domestic-stock/v1/quotations/intstock-multprice", params, "FHKST11300006")
    names = {c: (nm, m) for c, nm, m in chunk}
    for o in (data or {}).get("output", []) or []:
        c = o.get("inter_shrn_iscd", "")
        price = int(float(o.get("inter2_prpr", 0) or 0))
        if c not in names or price <= 0:
            continue
        item = {
            "code": c,
            "name": names[c][0],
            "source": "live",
            "market": "KOSPI" if names[c][1] == "P" else "KOSDAQ",
            "price": price,
            "prev_close": int(float(o.get("inter2_prdy_clpr", 0) or 0)) or price,
            "change": int(float(o.get("inter2_prdy_vrss", 0) or 0)),
            "change_rate": float(o.get("prdy_ctrt", 0) or 0),
            "volume": int(float(o.get("acml_vol", 0) or 0)),
            "trading_value": int(float(o.get("acml_tr_pbmn", 0) or 0)),
        }
        kis._cache_set(f"price:{c}", item)   # 종목 시세 조회도 이 값을 같이 씀
        out[c] = item


async def _sweep() -> dict | None:
    stocks = await _stock_list()
    if not stocks:
        return None
    quotes: dict[str, dict] = {}
    sem = asyncio.Semaphore(4)

    async def one(chunk):
        async with sem:
            await _quote_chunk(chunk, quotes)

    await asyncio.gather(*[one(stocks[i:i + 30]) for i in range(0, len(stocks), 30)])
    rows = [q for q in quotes.values() if q["volume"] > 0]
    if len(rows) < len(stocks) * 0.5:   # 절반 넘게 비면 실패로 보고 직전 결과 유지
        logger.warning("[RANK] 시세 %d/%d 만 받음", len(rows), len(stocks))
        return None

    def top(key, reverse=True, cond=None):
        src = [r for r in rows if cond is None or cond(r)]
        src.sort(key=key, reverse=reverse)
        return [{**r, "rank": i} for i, r in enumerate(src[:TOP_N], 1)]

    return {
        "at": time.time(),
        "count": len(rows),
        "amount": top(lambda r: r["trading_value"]),
        "volume": top(lambda r: r["volume"]),
        "up": top(lambda r: r["change_rate"], cond=lambda r: r["change_rate"] > 0),
        "down": top(lambda r: r["change_rate"], reverse=False, cond=lambda r: r["change_rate"] < 0),
    }


async def _shared() -> dict | None:
    raw = await kis._redis("GET", RKEY)
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    return None


async def get_ranking(kind: str) -> dict | None:
    """kind: amount / volume / up / down → {"ranking": [...], "count": 종목 수, "at": 시각} 또는 None"""
    age = _max_age()
    data = _local["data"]
    if not data or time.time() - data["at"] > age:
        shared = await _shared()
        if shared and (not data or shared["at"] > data["at"]):
            data = shared
            _local["data"] = data
    if not data or time.time() - data["at"] > age:
        # 다른 인스턴스가 돌고 있으면 직전 결과를 그대로 쓰고, 처음이면 잠깐 기다린다
        got = await kis._redis("SET", LOCK, "1", "NX", "EX", "30")
        if got or not (await kis._redis("GET", LOCK)):
            async with _sweep_lock:
                if not _local["data"] or time.time() - _local["data"]["at"] > age:
                    fresh = await _sweep()
                    if fresh:
                        _local["data"] = fresh
                        await kis._redis("SET", RKEY, json.dumps(fresh, ensure_ascii=False, separators=(",", ":")), "EX", "86400")
                    await kis._redis("DEL", LOCK)
            data = _local["data"]
        elif not data:
            for _ in range(10):
                await asyncio.sleep(1)
                data = await _shared()
                if data:
                    _local["data"] = data
                    break
    if not data:
        return None
    return {"ranking": data.get(kind, []), "count": data.get("count", 0), "at": data["at"]}
