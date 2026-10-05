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
from dotenv import load_dotenv

load_dotenv()

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
_token_lock = asyncio.Lock()

# KIS 초당 호출 한도: 실전 20건, 모의 2건 → 여유를 두고 제한
_RATE_PER_SEC = 15 if KIS_MODE == "real" else 2
_rate_lock = asyncio.Lock()
_last_call = 0.0


async def _throttle():
    global _last_call
    async with _rate_lock:
        wait = _last_call + 1 / _RATE_PER_SEC - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call = time.monotonic()


# 짧은 응답 캐시 (같은 데이터를 여러 클라이언트가 동시에 요청할 때 KIS 호출 절약)
_resp_cache: dict[str, tuple[float, Any]] = {}
# 최근 KIS 오류 (디버그용, /api/token/status 에 노출)
last_errors: dict[str, str] = {}


def _cache_get(key: str, ttl: float):
    hit = _resp_cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    return None


def _cache_set(key: str, value: Any):
    _resp_cache[key] = (time.monotonic(), value)

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
    placeholders = ("your_", "change_me", "example")
    values = (APP_KEY.strip().lower(), APP_SECRET.strip().lower())
    return all(
        len(value) > 10 and not any(marker in value for marker in placeholders)
        for value in values
    )


# ──────────────────────────────────────────────
# 인증
# ──────────────────────────────────────────────
# 서버리스에서는 인스턴스가 자주 새로 뜨므로, 공유 저장소(Upstash Redis)가 연결돼 있으면
# 토큰을 거기에 보관해 모든 인스턴스가 같은 토큰을 쓴다. (Vercel Marketplace 연결 시 환경변수 자동 생성)
_REDIS_URL = os.getenv("KV_REST_API_URL") or os.getenv("UPSTASH_REDIS_REST_URL") or ""
_REDIS_TOKEN = os.getenv("KV_REST_API_TOKEN") or os.getenv("UPSTASH_REDIS_REST_TOKEN") or ""
_REDIS_KEY = f"drmarket:kis_token:{KIS_MODE}"
_TOKEN_RETRY_SEC = 20   # 발급 실패 후 재시도 대기 (KIS 토큰 발급은 1분당 1회 제한)


async def _redis(*cmd: str):
    if not (_REDIS_URL and _REDIS_TOKEN):
        return None
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.post(_REDIS_URL, json=list(cmd),
                                     headers={"Authorization": f"Bearer {_REDIS_TOKEN}"})
            return resp.json().get("result")
    except Exception as e:
        logger.warning("[REDIS] %s 실패: %s", cmd[0], e)
        return None


def _token_valid() -> bool:
    return bool(_token_cache["access_token"]) and time.time() < _token_cache["expires_at"] - 300


async def get_access_token() -> str | None:
    """액세스 토큰: 메모리 → 공유 저장소 → 신규 발급 순으로 확보"""
    if _token_valid():
        return _token_cache["access_token"]

    if not _is_configured():
        logger.warning("[KIS] API 키 미설정 — 시뮬레이션 모드")
        return None

    # 동시 요청이 각자 토큰을 발급받지 않도록 직렬화
    async with _token_lock:
        if _token_valid():
            return _token_cache["access_token"]
        shared = await _redis("GET", _REDIS_KEY)
        if shared:
            try:
                item = json.loads(shared)
                if time.time() < item["expires_at"] - 300:
                    _token_cache.update(access_token=item["token"], expires_at=item["expires_at"])
                    return item["token"]
            except Exception:
                pass
        # 최근 발급 실패 직후면 바로 포기 (요청마다 재시도하며 지연되는 것 방지)
        if time.time() < _token_cache.get("retry_at", 0):
            return None
        token = await _issue_token()
        if token:
            ttl = max(60, int(_token_cache["expires_at"] - time.time()))
            await _redis("SET", _REDIS_KEY,
                         json.dumps({"token": token, "expires_at": _token_cache["expires_at"]}), "EX", str(ttl))
        else:
            _token_cache["retry_at"] = time.time() + _TOKEN_RETRY_SEC
        return token


async def _issue_token() -> str | None:
    now = time.time()
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
            data = resp.json()
            if "access_token" not in data:
                last_errors["tokenP"] = f"{data.get('error_code', resp.status_code)} {data.get('error_description', '')}"
                logger.error("[KIS] 토큰 발급 실패: %s", last_errors["tokenP"])
                return None
            _token_cache["access_token"] = data["access_token"]
            _token_cache["expires_at"] = now + data.get("expires_in", 86400)
            logger.info("[KIS] 토큰 발급 성공 (%s 모드)", KIS_MODE)
            return _token_cache["access_token"]
    except Exception as e:
        last_errors["tokenP"] = f"{type(e).__name__}: {str(e)[:120]}"
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
    for attempt in range(2):
        await _throttle()
        try:
            async with httpx.AsyncClient(timeout=10, verify=False) as client:
                resp = await client.get(
                    f"{BASE_URL}{path}",
                    params=params,
                    headers=_auth_headers(token, tr_id),
                )
                data = resp.json()
        except Exception as e:
            logger.error("[KIS] GET %s 실패: %s", path, e)
            status = locals().get("resp").status_code if locals().get("resp") is not None else "-"
            last_errors[tr_id] = f"HTTP {status} {type(e).__name__}: {str(e)[:120]}"
            return None
        if data.get("rt_cd") == "0":
            return data
        # EGW00201 = 초당 거래건수 초과 → 잠깐 쉬고 한 번 더
        if data.get("msg_cd") == "EGW00201" and attempt == 0:
            await asyncio.sleep(1)
            continue
        logger.warning("[KIS] API 오류 %s %s: %s", tr_id, data.get("msg_cd"), data.get("msg1"))
        last_errors[tr_id] = f"{data.get('msg_cd')} {data.get('msg1')}"
        return None
    return None


# ──────────────────────────────────────────────
# 시장 지수
# ──────────────────────────────────────────────
async def fetch_market_indices() -> list[dict]:
    """코스피·코스닥 지수 조회"""
    cached = _cache_get("indices", 10)
    if cached:
        return cached
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
            chg  = round(float(o.get("bstp_nmix_prdy_vrss", 0)), 2)
            rate = round(float(o.get("bstp_nmix_prdy_ctrt", 0)), 2)
            results.append({"name": name, "value": cur, "change": chg, "changeRate": rate, "flag": flag, "source": "live"})

    if any(r.get("source") == "live" for r in results):
        _cache_set("indices", results)
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
    """단일 종목 현재가 조회 (source: live=실제, demo=키 미설정 시뮬레이션, error=조회 실패)"""
    cached = _cache_get(f"price:{code}", 3)
    if cached:
        return cached
    if not _is_configured():
        meta = _MOCK_STOCKS.get(code, {"name": code, "base": 10000, "market": "KOSPI"})
        return {"code": code, "name": meta["name"], "market": meta["market"], "source": "demo",
                **_simulate_price(meta["base"])}

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
        result = {
            "code": code,
            "name": o.get("hts_kor_isnm", ""),
            "source": "live",
            "price": price,
            "prev_close": prev_close,
            "change": change,
            "change_rate": change_rate,
            "volume": volume,
            "trading_value": t_value,
        }
        _cache_set(f"price:{code}", result)
        return result

    # 키는 있는데 조회 실패 — 가짜 가격을 만들지 않고 실패로 알림
    return {"code": code, "source": "error", "price": 0}


async def fetch_batch_prices(codes: list[str]) -> list[dict]:
    """
    여러 종목 현재가. 실전 모드는 관심종목 멀티 시세(30종목/1회)로 조회하고,
    실패하거나 모의 모드면 종목별 조회로 대체.
    """
    results: dict[str, dict] = {}
    if _is_configured() and KIS_MODE == "real":
        for i in range(0, len(codes), 30):
            chunk = [c for c in codes[i:i + 30] if not _cache_get(f"price:{c}", 3)]
            if not chunk:
                continue
            params = {}
            for n, c in enumerate(chunk, 1):
                params[f"FID_COND_MRKT_DIV_CODE_{n}"] = "J"
                params[f"FID_INPUT_ISCD_{n}"] = c
            data = await _get("/uapi/domestic-stock/v1/quotations/intstock-multprice", params, "FHKST11300006")
            for o in (data or {}).get("output", []) or []:
                c = o.get("inter_shrn_iscd", "")
                price = int(float(o.get("inter2_prpr", 0) or 0))
                if not c or price <= 0:
                    continue
                prev = int(float(o.get("inter2_prdy_clpr", 0) or 0)) or price
                item = {
                    "code": c,
                    "name": o.get("inter_kor_isnm", ""),
                    "source": "live",
                    "price": price,
                    "prev_close": prev,
                    "change": int(float(o.get("inter2_prdy_vrss", 0) or 0)),
                    "change_rate": float(o.get("prdy_ctrt", 0) or 0),
                    "volume": int(float(o.get("acml_vol", 0) or 0)),
                    "trading_value": int(float(o.get("acml_tr_pbmn", 0) or 0)),
                }
                _cache_set(f"price:{c}", item)
                results[c] = item

    missing = [c for c in codes if c not in results]
    singles = await asyncio.gather(*[fetch_stock_price(c) for c in missing])
    for item in singles:
        results[item["code"]] = item
    return [results[c] for c in codes]


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
    # FID_BLNG_CLS_CODE: 0=평균거래량, 3=거래금액순
    blng_code = "3" if sort == "amount" else "0"
    cache_key = f"vrank:{mrkt_code}:{blng_code}"
    cached = _cache_get(cache_key, 10)
    if cached:
        return cached
    if not _is_configured():
        return _mock_ranking("amount" if sort == "amount" else "volume")

    data = await _get(
        "/uapi/domestic-stock/v1/quotations/volume-rank",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_COND_SCR_DIV_CODE":  "20171",
            "FID_INPUT_ISCD":         mrkt_code,
            "FID_DIV_CLS_CODE":       "0",
            "FID_BLNG_CLS_CODE":      blng_code,
            "FID_TRGT_CLS_CODE":      "111111111",
            "FID_TRGT_EXLS_CLS_CODE": "0000000000",
            "FID_INPUT_PRICE_1":      "0",
            "FID_INPUT_PRICE_2":      "0",
            "FID_VOL_CNT":            "0",
            "FID_INPUT_DATE_1":       "",
        },
        "FHPST01710000",
    )

    if data and data.get("output"):
        rows = []
        for i, o in enumerate(data["output"][:20], 1):
            price = int(o.get("stck_prpr", 0))
            prev  = price - int(o.get("prdy_vrss", 0))
            rows.append({
                "rank":         i,
                "code":         o.get("mksc_shrn_iscd", ""),
                "name":         o.get("hts_kor_isnm", ""),
                "source":       "live",
                "market":       "KOSPI" if o.get("bstp_kor_isnm","").startswith("코스피") else "KOSDAQ",
                "price":        price,
                "prev_close":   prev,
                "change":       price - prev,
                "change_rate":  float(o.get("prdy_ctrt", 0)),
                "volume":       int(o.get("acml_vol", 0)),
                "trading_value": int(o.get("acml_tr_pbmn", 0)),
            })
        _cache_set(cache_key, rows)
        return rows

    return []


async def fetch_change_rank(direction: str = "up") -> list[dict]:
    """상승률(up) / 하락률(down) 상위 종목"""
    cache_key = f"crank:{direction}"
    cached = _cache_get(cache_key, 10)
    if cached:
        return cached
    if not _is_configured():
        return _mock_ranking("change_up" if direction == "up" else "change_down")

    data = await _get(
        "/uapi/domestic-stock/v1/ranking/fluctuation",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_COND_SCR_DIV_CODE":  "20170",
            "FID_INPUT_ISCD":         "0000",
            "FID_RANK_SORT_CLS_CODE": "0" if direction == "up" else "1",
            "FID_INPUT_CNT_1":        "0",
            "FID_PRC_CLS_CODE":       "0",
            "FID_INPUT_PRICE_1":      "",
            "FID_INPUT_PRICE_2":      "",
            "FID_VOL_CNT":            "",
            "FID_TRGT_CLS_CODE":      "0",
            "FID_TRGT_EXLS_CLS_CODE": "0",
            "FID_DIV_CLS_CODE":       "0",
            "FID_RSFL_RATE1":         "",
            "FID_RSFL_RATE2":         "",
        },
        "FHPST01700000",
    )

    if data and data.get("output"):
        rows = []
        for i, o in enumerate(data["output"][:20], 1):
            price = int(o.get("stck_prpr", 0))
            prev  = price - int(o.get("prdy_vrss", 0))
            rows.append({
                "rank":         i,
                "code":         o.get("stck_shrn_iscd", "") or o.get("mksc_shrn_iscd", ""),
                "name":         o.get("hts_kor_isnm", ""),
                "source":       "live",
                "market":       "KOSDAQ" if o.get("mksc_shrn_iscd","").startswith("9") else "KOSPI",
                "price":        price,
                "prev_close":   prev,
                "change":       price - prev,
                "change_rate":  float(o.get("prdy_ctrt", 0)),
                "volume":       int(o.get("acml_vol", 0)),
                "trading_value": int(o.get("acml_tr_pbmn", 0)),
            })
        # 감자·거래재개 등으로 반대 방향 종목이 섞여 나오는 경우 제외
        rows = [r for r in rows if (r["change_rate"] > 0) == (direction == "up")]
        for i, r in enumerate(rows, 1):
            r["rank"] = i
        _cache_set(cache_key, rows)
        return rows

    last_errors["FHPST01700000"] = "빈 응답" if data else last_errors.get("FHPST01700000", "응답 없음")
    return []


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
        return []

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
                    "link":    item.get("link", "") or item.get("originallink", ""),
                    "time":    item.get("pubDate", ""),
                    "tag":     "뉴스",
                }
                for item in items
            ]
    except Exception as e:
        logger.warning("[NAVER] 뉴스 조회 실패: %s", e)
        return []


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
                yield {"code": code, "name": meta.get("name", code), "source": "demo", **sim}
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
                            "source":      "live",
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


# ──────────────────────────────────────────────
# 종목 상세 · 차트 (실데이터)
# ──────────────────────────────────────────────
def _num(v, cast=float):
    try:
        return cast(float(v))
    except (TypeError, ValueError):
        return cast(0)


async def fetch_stock_detail(code: str) -> dict | None:
    """현재가 + 시가/고가/저가, 52주 고저, 시가총액, PER/PBR 등"""
    cached = _cache_get(f"detail:{code}", 5)
    if cached:
        return cached
    data = await _get(
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
        "FHKST01010100",
    )
    if not data or not data.get("output"):
        return None
    o = data["output"]
    result = {
        "code": code,
        "source": "live",
        "price": _num(o.get("stck_prpr"), int),
        "change": _num(o.get("prdy_vrss"), int),
        "change_rate": _num(o.get("prdy_ctrt")),
        "open": _num(o.get("stck_oprc"), int),
        "high": _num(o.get("stck_hgpr"), int),
        "low": _num(o.get("stck_lwpr"), int),
        "prev_close": _num(o.get("stck_sdpr"), int),
        "upper_limit": _num(o.get("stck_mxpr"), int),
        "lower_limit": _num(o.get("stck_llam"), int),
        "volume": _num(o.get("acml_vol"), int),
        "trading_value": _num(o.get("acml_tr_pbmn"), int),
        "market_cap": _num(o.get("hts_avls"), int) * 100_000_000,   # 억원 → 원
        "per": _num(o.get("per")),
        "pbr": _num(o.get("pbr")),
        "eps": _num(o.get("eps")),
        "w52_high": _num(o.get("w52_hgpr"), int),
        "w52_low": _num(o.get("w52_lwpr"), int),
        "foreign_ratio": _num(o.get("hts_frgn_ehrt")),
        "sector": o.get("bstp_kor_isnm", ""),
    }
    _cache_set(f"detail:{code}", result)
    return result


async def fetch_daily_chart(code: str, period: str = "D", is_index: bool = False) -> list[dict]:
    """일/주/월봉 (최대 100개). is_index=True 면 업종지수(0001=코스피, 1001=코스닥)"""
    period = period if period in ("D", "W", "M") else "D"
    key = f"chart:{'U' if is_index else 'J'}:{code}:{period}"
    cached = _cache_get(key, 60)
    if cached:
        return cached
    end = datetime.now()
    span = {"D": 160, "W": 800, "M": 3300}[period]
    start = end - timedelta(days=span)
    params = {
        "FID_COND_MRKT_DIV_CODE": "U" if is_index else "J",
        "FID_INPUT_ISCD": code,
        "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
        "FID_INPUT_DATE_2": end.strftime("%Y%m%d"),
        "FID_PERIOD_DIV_CODE": period,
    }
    if is_index:
        path, tr = "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice", "FHKUP03500100"
        f = ("bstp_nmix_oprc", "bstp_nmix_hgpr", "bstp_nmix_lwpr", "bstp_nmix_prpr")
    else:
        params["FID_ORG_ADJ_PRC"] = "0"
        path, tr = "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice", "FHKST03010100"
        f = ("stck_oprc", "stck_hgpr", "stck_lwpr", "stck_clpr")
    data = await _get(path, params, tr)
    rows = []
    for o in (data or {}).get("output2", []) or []:
        d = o.get("stck_bsop_date")
        if not d:
            continue
        rows.append({
            "t": f"{d[:4]}-{d[4:6]}-{d[6:]}",
            "o": _num(o.get(f[0])), "h": _num(o.get(f[1])),
            "l": _num(o.get(f[2])), "c": _num(o.get(f[3])),
            "v": _num(o.get("acml_vol"), int),
        })
    rows.reverse()   # 오래된 → 최신
    if rows:
        _cache_set(key, rows)
    return rows


async def fetch_minute_chart(code: str) -> list[dict]:
    """당일 1분봉 (09:00~현재). KIS는 1회 30개씩이라 거꾸로 이어 붙인다."""
    key = f"minute:{code}"
    cached = _cache_get(key, 20)
    if cached:
        return cached
    now = datetime.utcnow() + timedelta(hours=9)
    hour = min(now.strftime("%H%M%S"), "153000")
    if hour < "090000":
        hour = "153000"   # 장 시작 전에는 직전 거래일 마감까지
    seen: dict[str, dict] = {}
    for _ in range(14):
        data = await _get(
            "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
            {"FID_ETC_CLS_CODE": "", "FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code,
             "FID_INPUT_HOUR_1": hour, "FID_PW_DATA_INCU_YN": "N"},
            "FHKST03010200",
        )
        out = (data or {}).get("output2", []) or []
        out = [o for o in out if o.get("stck_cntg_hour")]
        if not out:
            break
        for o in out:
            h = o["stck_cntg_hour"]
            seen[h] = {
                "t": f"{h[:2]}:{h[2:4]}",
                "o": _num(o.get("stck_oprc")), "h": _num(o.get("stck_hgpr")),
                "l": _num(o.get("stck_lwpr")), "c": _num(o.get("stck_prpr")),
                "v": _num(o.get("cntg_vol"), int),
            }
        earliest = min(o["stck_cntg_hour"] for o in out)
        if earliest <= "090000":
            break
        # 가장 이른 봉 1분 전부터 다시 조회
        t = datetime.strptime(earliest, "%H%M%S") - timedelta(minutes=1)
        hour = t.strftime("%H%M%S")
    rows = [seen[k] for k in sorted(seen)]
    if rows:
        _cache_set(key, rows)
    return rows


async def fetch_orderbook(code: str) -> dict | None:
    """10단계 매도·매수 호가와 잔량"""
    cached = _cache_get(f"book:{code}", 2)
    if cached:
        return cached
    data = await _get(
        "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
        {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
        "FHKST01010200",
    )
    o = (data or {}).get("output1")
    if not o:
        return None
    asks = [{"price": _num(o.get(f"askp{i}"), int), "qty": _num(o.get(f"askp_rsqn{i}"), int)} for i in range(1, 11)]
    bids = [{"price": _num(o.get(f"bidp{i}"), int), "qty": _num(o.get(f"bidp_rsqn{i}"), int)} for i in range(1, 11)]
    exp = (data or {}).get("output2") or {}
    result = {
        "code": code,
        "source": "live",
        "time": o.get("aspr_acpt_hour", ""),
        "asks": [a for a in asks if a["price"] > 0],   # 1호가(가장 낮은 매도)부터
        "bids": [b for b in bids if b["price"] > 0],   # 1호가(가장 높은 매수)부터
        "total_ask": _num(o.get("total_askp_rsqn"), int),
        "total_bid": _num(o.get("total_bidp_rsqn"), int),
        "expected_price": _num(exp.get("antc_cnpr"), int),
    }
    _cache_set(f"book:{code}", result)
    return result
