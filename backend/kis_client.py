"""
한국투자증권 (KIS) Open API 클라이언트
- 토큰 자동 발급/갱신 (24시간)
- 실전투자 / 모의투자 자동 전환
- 실패 시 현실적인 시뮬레이션 데이터 반환
"""

import asyncio
import json
import logging
import os
import time
import random
from datetime import datetime, timedelta
from typing import Any

import httpx
import websockets

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
KIS_MODE = os.getenv("KIS_MODE", "paper").lower()          # "real" | "paper"

_cfg = {
    "real": {
        "base_url":  "https://openapi.koreainvestment.com:9443",
        "ws_url":    "wss://openapi.koreainvestment.com:9443",
        "app_key":   os.getenv("KIS_APP_KEY", ""),
        "app_secret": os.getenv("KIS_APP_SECRET", ""),
        "tr_cont": "N",
    },
    "paper": {
        "base_url":  "https://openapivts.koreainvestment.com:29443",
        "ws_url":    "wss://openapivts.koreainvestment.com:29443",
        "app_key":   os.getenv("KIS_PAPER_APP_KEY", ""),
        "app_secret": os.getenv("KIS_PAPER_APP_SECRET", ""),
        "tr_cont": "N",
    },
}

CFG = _cfg[KIS_MODE]
BASE_URL = CFG["base_url"]
APP_KEY  = CFG["app_key"]
APP_SECRET = CFG["app_secret"]

# ──────────────────────────────────────────────
# 토큰 캐시
# ──────────────────────────────────────────────
_token_cache: dict[str, Any] = {"access_token": None, "expires_at": 0, "approval_key": None}

# ──────────────────────────────────────────────
# Mock 데이터 (API 미설정 시 사용)
# ──────────────────────────────────────────────
_MOCK_STOCKS = {
    "005930": {"name": "삼성전자",     "base": 70300,  "market": "KOSPI"},
    "000660": {"name": "SK하이닉스",   "base": 178500, "market": "KOSPI"},
    "373220": {"name": "LG에너지솔루션","base": 412000,"market": "KOSPI"},
    "207940": {"name": "삼성바이오로직스","base":998000,"market":"KOSPI"},
    "028300": {"name": "HLB",          "base": 42350,  "market": "KOSDAQ"},
    "068270": {"name": "셀트리온",     "base": 182500, "market": "KOSPI"},
    "042660": {"name": "한화오션",     "base": 117600, "market": "KOSPI"},
    "012450": {"name": "한화에어로스페이스","base":382000,"market":"KOSPI"},
    "035420": {"name": "네이버",       "base": 198000, "market": "KOSPI"},
    "035720": {"name": "카카오",       "base": 63900,  "market": "KOSPI"},
    "009540": {"name": "HD현대중공업", "base": 480500, "market": "KOSPI"},
    "097230": {"name": "HJ중공업",     "base": 13190,  "market": "KOSPI"},
    "352820": {"name": "하이브",       "base": 198000, "market": "KOSPI"},
    "036800": {"name": "사피엔반도체", "base": 57700,  "market": "KOSDAQ"},
    "950200": {"name": "와이랩",       "base": 12550,  "market": "KOSDAQ"},
    "058990": {"name": "키네마스터",   "base": 7250,   "market": "KOSDAQ"},
    "302430": {"name": "이노뎁",       "base": 16140,  "market": "KOSDAQ"},
}

_MOCK_INDICES = [
    {"name": "코스피",      "value": 2621.45, "change": 18.32,  "changeRate": 0.70,  "flag": "🇰🇷"},
    {"name": "코스닥",      "value": 748.12,  "change": 6.45,   "changeRate": 0.87,  "flag": "🇰🇷"},
    {"name": "코스피야간",  "value": 357.85,  "change": -1.20,  "changeRate": -0.33, "flag": "🌙"},
    {"name": "나스닥선물",  "value": 19842.50,"change": 123.40, "changeRate": 0.63,  "flag": "🇺🇸"},
    {"name": "나스닥",      "value": 19432.10,"change": -45.20, "changeRate": -0.23, "flag": "🇺🇸"},
    {"name": "다우",        "value": 42315.65,"change": 210.80, "changeRate": 0.50,  "flag": "🇺🇸"},
]


def _simulate_price(base: float) -> dict:
    """기준가 기반 시뮬레이션 현재가 생성"""
    ratio = 1 + random.uniform(-0.05, 0.08)
    price = round(base * ratio / 10) * 10 if base >= 1000 else round(base * ratio)
    prev_close = round(base * (1 + random.uniform(-0.03, 0.03)) / 10) * 10 if base >= 1000 else round(base * (1 + random.uniform(-0.03, 0.03)))
    change_rate = round((price - prev_close) / prev_close * 100, 2)
    volume = random.randint(500_000, 15_000_000)
    trading_value = price * volume
    return {
        "price": price,
        "prev_close": prev_close,
        "change": price - prev_close,
        "change_rate": change_rate,
        "volume": volume,
        "trading_value": trading_value,
    }


def _is_configured() -> bool:
    return bool(APP_KEY and APP_SECRET and len(APP_KEY) > 10)


# ──────────────────────────────────────────────
# 인증
# ──────────────────────────────────────────────
async def get_access_token() -> str | None:
    """액세스 토큰 발급/캐시 반환"""
    now = time.time()
    if _token_cache["access_token"] and now < _token_cache["expires_at"] - 300:
        return _token_cache["access_token"]

    if not _is_configured():
        logger.warning("[KIS] API 키 미설정 — 시뮬레이션 모드")
        return None

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{BASE_URL}/oauth2/tokenP",
                json={
                    "grant_type": "client_credentials",
                    "appkey": APP_KEY,
                    "appsecret": APP_SECRET,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            _token_cache["access_token"] = data["access_token"]
            _token_cache["expires_at"] = now + data.get("expires_in", 86400)
            logger.info("[KIS] 토큰 발급 성공 (%s 모드)", KIS_MODE)
            return _token_cache["access_token"]
    except Exception as e:
        logger.error("[KIS] 토큰 발급 실패: %s", e)
        return None


async def get_ws_approval_key() -> str | None:
    """WebSocket 실시간 접속 키 발급"""
    if _token_cache["approval_key"]:
        return _token_cache["approval_key"]
    if not _is_configured():
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{BASE_URL}/oauth2/Approval",
                json={"grant_type": "client_credentials", "appkey": APP_KEY, "secretkey": APP_SECRET},
            )
            resp.raise_for_status()
            key = resp.json().get("approval_key")
            _token_cache["approval_key"] = key
            return key
    except Exception as e:
        logger.error("[KIS] WebSocket 키 발급 실패: %s", e)
        return None


def _auth_headers(token: str, tr_id: str, extra: dict | None = None) -> dict:
    h = {
        "Content-Type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": tr_id,
        "custtype": "P",
    }
    if extra:
        h.update(extra)
    return h


# ──────────────────────────────────────────────
# REST API 호출 헬퍼
# ──────────────────────────────────────────────
async def _get(path: str, params: dict, tr_id: str) -> dict | None:
    token = await get_access_token()
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            resp = await client.get(
                f"{BASE_URL}{path}",
                params=params,
                headers=_auth_headers(token, tr_id),
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("rt_cd") != "0":
                logger.warning("[KIS] API 오류: %s", data.get("msg1"))
                return None
            return data
    except Exception as e:
        logger.error("[KIS] GET %s 실패: %s", path, e)
        return None


# ──────────────────────────────────────────────
# 시장 지수
# ──────────────────────────────────────────────
async def fetch_market_indices() -> list[dict]:
    """코스피·코스닥 지수 조회"""
    token = await get_access_token()
    if not token:
        return _mock_indices()

    results = []
    index_map = [
        ("0001", "코스피",   "🇰🇷"),
        ("1001", "코스닥",   "🇰🇷"),
    ]
    for code, name, flag in index_map:
        data = await _get(
            "/uapi/domestic-stock/v1/quotations/inquire-index-price",
            {"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": code},
            "FHPUP02100000",
        )
        if data and data.get("output"):
            o = data["output"]
            cur  = float(o.get("bstp_nmix_prpr", 0))
            prev = float(o.get("bstp_nmix_prdy_clpr", cur))
            chg  = round(cur - prev, 2)
            rate = round(float(o.get("bstp_nmix_prdy_ctrt", 0)), 2)
            results.append({"name": name, "value": cur, "change": chg, "changeRate": rate, "flag": flag})
        else:
            results.append(_mock_index_for(name, flag))

    # 해외 지수는 시뮬레이션 (KIS API 미지원)
    results += [
        {"name": "코스피야간", "value": round(357.85 + random.uniform(-2, 2), 2), "change": round(random.uniform(-3, 3), 2), "changeRate": round(random.uniform(-0.5, 0.5), 2), "flag": "🌙"},
        {"name": "나스닥선물", "value": round(19842.5 + random.uniform(-100, 100), 2), "change": round(random.uniform(-80, 80), 2), "changeRate": round(random.uniform(-0.5, 0.5), 2), "flag": "🇺🇸"},
        {"name": "나스닥",    "value": round(19432.1 + random.uniform(-100, 100), 2), "change": round(random.uniform(-80, 80), 2), "changeRate": round(random.uniform(-0.5, 0.5), 2), "flag": "🇺🇸"},
        {"name": "다우",      "value": round(42315.6 + random.uniform(-200, 200), 2), "change": round(random.uniform(-200, 200), 2), "changeRate": round(random.uniform(-0.5, 0.5), 2), "flag": "🇺🇸"},
    ]
    return results


def _mock_index_for(name: str, flag: str) -> dict:
    base_map = {"코스피": (2621.45, 18.32, 0.70), "코스닥": (748.12, 6.45, 0.87)}
    b = base_map.get(name, (1000, 0, 0))
    return {"name": name, "value": round(b[0] + random.uniform(-5, 5), 2), "change": round(b[1] + random.uniform(-1, 1), 2), "changeRate": round(b[2] + random.uniform(-0.1, 0.1), 2), "flag": flag}


def _mock_indices() -> list[dict]:
    results = []
    for idx in _MOCK_INDICES:
        results.append({
            **idx,
            "value":      round(idx["value"] + random.uniform(-idx["value"]*0.005, idx["value"]*0.005), 2),
            "change":     round(idx["change"] + random.uniform(-1, 1), 2),
            "changeRate": round(idx["changeRate"] + random.uniform(-0.1, 0.1), 2),
        })
    return results


# ──────────────────────────────────────────────
# 주식 현재가
# ──────────────────────────────────────────────
async def fetch_stock_price(code: str) -> dict:
    """단일 종목 현재가 조회"""
    data = await _get(
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
        "FHKST01010100",
    )
    if data and data.get("output"):
        o = data["output"]
        price      = int(o.get("stck_prpr", 0))
        prev_close = int(o.get("stck_sdpr", price))
        change     = int(o.get("prdy_vrss", 0))
        change_rate = float(o.get("prdy_ctrt", 0))
        volume     = int(o.get("acml_vol", 0))
        t_value    = int(o.get("acml_tr_pbmn", 0))
        return {
            "code": code,
            "name": o.get("hts_kor_isnm", ""),
            "price": price,
            "prev_close": prev_close,
            "change": change,
            "change_rate": change_rate,
            "volume": volume,
            "trading_value": t_value,
        }

    # 시뮬레이션 폴백
    meta = _MOCK_STOCKS.get(code, {"name": code, "base": 10000, "market": "KOSPI"})
    sim = _simulate_price(meta["base"])
    return {"code": code, "name": meta["name"], "market": meta["market"], **sim}


# ──────────────────────────────────────────────
# 거래대금/거래량/상승률 순위
# ──────────────────────────────────────────────
async def fetch_volume_rank(market: str = "J", sort: str = "amount") -> list[dict]:
    """
    거래대금(amount) / 거래량(volume) 상위 종목
    market: J=KOSPI, Q=KOSDAQ, 전체=''
    """
    # FID_INPUT_ISCD: 0000=전체, 0001=KOSPI, 1001=KOSDAQ
    mrkt_code = "0001" if market == "J" else ("1001" if market == "Q" else "0000")
    sort_code  = "1" if sort == "amount" else "2"   # 1=거래대금, 2=거래량

    data = await _get(
        "/uapi/domestic-stock/v1/quotations/volume-rank",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_COND_SCR_DIV_CODE":  "20171",
            "FID_INPUT_ISCD":         mrkt_code,
            "FID_DIV_CLS_CODE":       "0",
            "FID_BLNG_CLS_CODE":      "0",
            "FID_TRGT_CLS_CODE":      "111111111",
            "FID_TRGT_EXLS_CLS_CODE": "0000000000",
            "FID_INPUT_PRICE_1":      "0",
            "FID_INPUT_PRICE_2":      "0",
            "FID_VOL_CNT":            "0",
            "FID_INPUT_DATE_1":       "",
        },
        "FHPST01700000",
    )

    if data and data.get("output"):
        rows = []
        for i, o in enumerate(data["output"][:20], 1):
            price = int(o.get("stck_prpr", 0))
            prev  = int(o.get("stck_sdpr", price))
            rows.append({
                "rank":         i,
                "code":         o.get("mksc_shrn_iscd", ""),
                "name":         o.get("hts_kor_isnm", ""),
                "market":       "KOSPI" if o.get("bstp_kor_isnm","").startswith("코스피") else "KOSDAQ",
                "price":        price,
                "prev_close":   prev,
                "change":       price - prev,
                "change_rate":  float(o.get("prdy_ctrt", 0)),
                "volume":       int(o.get("acml_vol", 0)),
                "trading_value": int(o.get("acml_tr_pbmn", 0)),
            })
        return rows

    return _mock_ranking("amount" if sort == "amount" else "volume")


async def fetch_change_rank(direction: str = "up") -> list[dict]:
    """상승률(up) / 하락률(down) 상위 종목"""
    data = await _get(
        "/uapi/domestic-stock/v1/quotations/fluctuation-rank",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_COND_SCR_DIV_CODE":  "20170",
            "FID_INPUT_ISCD":         "0000",
            "FID_RANK_SORT_CLS_CODE": "0" if direction == "up" else "1",
            "FID_INPUT_CNT_1":        "0",
            "FID_PRC_CLS_CODE":       "0",
            "FID_INPUT_PRICE_1":      "0",
            "FID_INPUT_PRICE_2":      "0",
            "FID_VOL_CNT":            "0",
            "FID_TRGT_CLS_CODE":      "0",
            "FID_TRGT_EXLS_CLS_CODE": "0",
            "FID_DIV_CLS_CODE":       "0",
            "FID_RST_DIV_CODE":       "0",
        },
        "FHPST01700000",
    )

    if data and data.get("output"):
        rows = []
        for i, o in enumerate(data["output"][:20], 1):
            price = int(o.get("stck_prpr", 0))
            prev  = int(o.get("stck_sdpr", price))
            rows.append({
                "rank":         i,
                "code":         o.get("mksc_shrn_iscd", ""),
                "name":         o.get("hts_kor_isnm", ""),
                "market":       "KOSDAQ" if o.get("mksc_shrn_iscd","").startswith("9") else "KOSPI",
                "price":        price,
                "prev_close":   prev,
                "change":       price - prev,
                "change_rate":  float(o.get("prdy_ctrt", 0)),
                "volume":       int(o.get("acml_vol", 0)),
                "trading_value": int(o.get("acml_tr_pbmn", 0)),
            })
        return rows

    return _mock_ranking("change_up" if direction == "up" else "change_down")


# ──────────────────────────────────────────────
# Mock 랭킹 데이터
# ──────────────────────────────────────────────
_MOCK_RANK_BASE = [
    ("005930", "삼성전자",      "KOSPI",  70300),
    ("042660", "한화오션",      "KOSPI",  117600),
    ("373220", "LG에너지솔루션","KOSPI",  412000),
    ("234690", "네이처셀",      "KOSDAQ", 20200),
    ("012450", "한화에어로스페이스","KOSPI",382000),
    ("352820", "하이브",        "KOSPI",  198000),
    ("028300", "HLB",           "KOSDAQ", 42350),
    ("030520", "아이티켐",      "KOSDAQ", 31950),
    ("068270", "셀트리온",      "KOSPI",  182500),
    ("036800", "사피엔반도체",  "KOSDAQ", 57700),
    ("097230", "HJ중공업",      "KOSPI",  13190),
    ("950200", "와이랩",        "KOSDAQ", 12550),
    ("058990", "키네마스터",    "KOSDAQ", 7250),
    ("302430", "이노뎁",        "KOSDAQ", 16140),
    ("009540", "HD현대중공업",  "KOSPI",  480500),
]


def _mock_ranking(sort_key: str) -> list[dict]:
    rows = []
    for i, (code, name, market, base) in enumerate(_MOCK_RANK_BASE):
        sim = _simulate_price(base)
        rows.append({
            "rank": i + 1,
            "code": code,
            "name": name,
            "market": market,
            **sim,
        })

    if sort_key == "amount":
        rows.sort(key=lambda x: x["trading_value"], reverse=True)
    elif sort_key == "volume":
        rows.sort(key=lambda x: x["volume"], reverse=True)
    elif sort_key == "change_up":
        rows.sort(key=lambda x: x["change_rate"], reverse=True)
    elif sort_key == "change_down":
        rows.sort(key=lambda x: x["change_rate"])

    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows[:15]


# ──────────────────────────────────────────────
# 뉴스 (네이버 검색 API)
# ──────────────────────────────────────────────
async def fetch_stock_news(stock_name: str, count: int = 5) -> list[dict]:
    client_id     = os.getenv("NAVER_CLIENT_ID", "")
    client_secret = os.getenv("NAVER_CLIENT_SECRET", "")

    if not (client_id and client_secret):
        return _mock_news(stock_name)

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                "https://openapi.naver.com/v1/search/news.json",
                params={"query": f"{stock_name} 주가", "display": count, "sort": "date"},
                headers={"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret},
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
            return [
                {
                    "title":   _strip_html(item.get("title", "")),
                    "source":  item.get("originallink", ""),
                    "time":    item.get("pubDate", ""),
                    "tag":     "뉴스",
                }
                for item in items
            ]
    except Exception as e:
        logger.warning("[NAVER] 뉴스 조회 실패: %s", e)
        return _mock_news(stock_name)


def _strip_html(text: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", text).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')


def _mock_news(name: str) -> list[dict]:
    now = datetime.now()
    templates = [
        f"{name}, 외국인 순매수 유입에 강세",
        f"[특징주] {name} 52주 신고가 경신",
        f"{name} 관련 테마주 동반 상승 주목",
        f"증권가 '{name} 목표주가 상향'…매수의견 유지",
        f"{name}, 2분기 실적 기대감에 선반영 매수",
    ]
    return [
        {"title": t, "source": "", "time": (now - timedelta(minutes=i*15)).strftime("%H:%M"), "tag": "뉴스"}
        for i, t in enumerate(templates)
    ]


# ──────────────────────────────────────────────
# WebSocket 실시간 시세 스트림 (제너레이터)
# ──────────────────────────────────────────────
async def realtime_price_stream(codes: list[str]):
    """
    구독 종목의 실시간 체결가를 비동기 제너레이터로 산출.
    - KIS WebSocket 연결 성공 시 실제 데이터
    - 실패 시 시뮬레이션 데이터 (1.5초 간격)
    """
    approval_key = await get_ws_approval_key()

    if not approval_key:
        logger.info("[WS] 시뮬레이션 스트림 시작 (%d 종목)", len(codes))
        while True:
            for code in codes:
                meta = _MOCK_STOCKS.get(code, {"name": code, "base": 10000})
                sim  = _simulate_price(meta["base"])
                yield {"code": code, "name": meta.get("name", code), **sim}
            await asyncio.sleep(1.5)
        return

    # ── KIS WebSocket 연결 ──
    ws_url = CFG["ws_url"] + "/tryitout/H0STCNT0"
    logger.info("[WS] KIS 실시간 연결: %s", ws_url)

    while True:
        try:
            async with websockets.connect(ws_url, ping_interval=30) as ws:
                # 종목 구독
                for code in codes:
                    sub_msg = json.dumps({
                        "header": {
                            "approval_key": approval_key,
                            "custtype":     "P",
                            "tr_type":      "1",   # 1=등록
                            "content-type": "utf-8",
                        },
                        "body": {
                            "input": {"tr_id": "H0STCNT0", "tr_key": code}
                        },
                    })
                    await ws.send(sub_msg)

                async for raw in ws:
                    try:
                        # KIS는 '|' 구분 pipe 포맷
                        if raw.startswith("{"):
                            continue  # 시스템 메시지 무시
                        parts = raw.split("|")
                        if len(parts) < 4:
                            continue
                        tr_id = parts[1]
                        if tr_id != "H0STCNT0":
                            continue
                        fields = parts[3].split("^")
                        code   = fields[0]
                        price  = int(fields[2])
                        prev   = int(fields[9]) if len(fields) > 9 else price
                        rate   = float(fields[5]) if len(fields) > 5 else 0.0
                        vol    = int(fields[8]) if len(fields) > 8 else 0
                        yield {
                            "code":        code,
                            "price":       price,
                            "prev_close":  prev,
                            "change":      price - prev,
                            "change_rate": rate,
                            "volume":      vol,
                        }
                    except Exception:
                        continue

        except Exception as e:
            logger.error("[WS] 연결 오류: %s — 5초 후 재연결", e)
            await asyncio.sleep(5)
