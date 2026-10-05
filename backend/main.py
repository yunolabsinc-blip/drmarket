"""
닥터마켓 백엔드 서버
FastAPI + 한국투자증권 Open API
Railway 배포용
"""

import asyncio
import json
import logging
import os
import random
import re
from contextlib import asynccontextmanager
from datetime import datetime

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request, Header
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

import kis_client as kis
import market_events
import news
import stats

# ──────────────────────────────────────────────
# 로깅
# ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("drmarket")

# ──────────────────────────────────────────────
# WebSocket 연결 관리자
# ──────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        logger.info("[WS] 클라이언트 연결 (총 %d)", len(self.active))

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
        logger.info("[WS] 클라이언트 해제 (총 %d)", len(self.active))

    async def broadcast(self, message: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in self.active:
                self.active.remove(ws)


manager = ConnectionManager()

# 기본 구독 종목 (WebSocket 브로드캐스트용)
DEFAULT_WATCH = [
    "097230","000100","009540","042660","030520","319400",
    "096690","234690","034020","009290","005930","009150",
    "145020","263720","078520","950130","950200","095500",
    "035620","058420","036800","033560","046310","044990",
    "058990","302430","000990","047560","373220","006400",
    "051910","000270","012450","047050","064350","272210",
    "028300","207940","068270","000020",
]

# ──────────────────────────────────────────────
# 백그라운드: 실시간 가격 → 모든 클라이언트에 브로드캐스트
# ──────────────────────────────────────────────
async def _broadcast_loop():
    """KIS 실시간 스트림 → 연결된 모든 WebSocket 클라이언트에 전달"""
    logger.info("[BG] 브로드캐스트 루프 시작")
    async for tick in kis.realtime_price_stream(DEFAULT_WATCH):
        if manager.active:
            await manager.broadcast({"type": "price", "data": tick})


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Vercel 같은 서버리스에서는 상시 실행 루프를 돌릴 수 없으므로 REST 폴링만 사용
    if os.getenv("VERCEL"):
        logger.info("[서버] 서버리스 모드 — 실시간 WebSocket 비활성화 (%s)", kis.KIS_MODE)
        yield
        return
    task = asyncio.create_task(_broadcast_loop())
    logger.info("[서버] 시작 완료 — 모드: %s", kis.KIS_MODE)
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# ──────────────────────────────────────────────
# FastAPI 앱
# ──────────────────────────────────────────────
app = FastAPI(
    title="닥터마켓 API",
    description="한국 실시간 주식 정보 서버 (한국투자증권 Open API 연동)",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
allowed_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# 헬스체크
# ──────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    return HTMLResponse("""
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>닥터마켓 API</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:20px;color:#2D2318;}
    h1{color:#D97757;} code{background:#FDF0E8;padding:2px 8px;border-radius:4px;font-size:14px;}
    a{color:#D97757;} .tag{background:#D97757;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:6px;}
    ul{line-height:2;}
  </style>
</head>
<body>
  <h1>🩺 닥터마켓 API 서버</h1>
  <p>한국투자증권 Open API 기반 실시간 주식 정보 서버입니다.</p>
  <hr>
  <h3>주요 엔드포인트</h3>
  <ul>
    <li><span class="tag">GET</span><code>/api/market/indices</code> — 시장 지수 (코스피, 코스닥)</li>
    <li><span class="tag">GET</span><code>/api/stock/{code}/price</code> — 종목 현재가</li>
    <li><span class="tag">GET</span><code>/api/stock/{code}/news</code> — 종목 관련 뉴스</li>
    <li><span class="tag">GET</span><code>/api/ranking/amount</code> — 거래대금 상위</li>
    <li><span class="tag">GET</span><code>/api/ranking/change</code> — 상승률 상위</li>
    <li><span class="tag">GET</span><code>/api/ranking/volume</code> — 거래량 상위</li>
    <li><span class="tag">WS</span><code>/ws/prices</code> — 실시간 체결가 스트림</li>
  </ul>
  <p><a href="/docs">📖 Swagger UI (전체 API 문서)</a></p>
  <hr>
  <p style="font-size:12px;color:#9C8878;">
    모드: <strong>""" + kis.KIS_MODE + """</strong> |
    API 키: <strong>""" + ("설정됨 ✅" if kis._is_configured() else "미설정 — 시뮬레이션 모드 ⚠️") + """</strong>
  </p>
</body>
</html>
""")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "mode": kis.KIS_MODE,
        "api_configured": kis._is_configured(),
        "market": kis.KIS_MARKET,   # UN=KRX+NXT 통합
        "realtime_ws": not os.getenv("VERCEL"),
        "ws_clients": len(manager.active),
        "time": datetime.now().isoformat(),
    }


# ──────────────────────────────────────────────
# 시장 지수
# ──────────────────────────────────────────────
@app.get("/api/market/indices", summary="시장 지수")
async def get_market_indices():
    """
    코스피, 코스닥, 나스닥선물, 나스닥, 다우, 코스피야간선물 지수를 반환합니다.
    - 한투 API 설정 시 코스피·코스닥은 실시간, 해외 지수는 근사 시뮬레이션
    """
    return {"indices": await kis.fetch_market_indices()}


@app.get("/api/market/overview", summary="시장종합")
async def get_market_overview():
    """투자자별 순매수(코스피·코스닥), 코스피 업종별 등락, 미국 주요 지수"""
    kospi, kosdaq, sectors, global_ = await asyncio.gather(
        kis.fetch_investor_flow("kospi"), kis.fetch_investor_flow("kosdaq"),
        kis.fetch_sectors(), kis.fetch_global_indices(),
    )
    return {"investors": {"kospi": kospi, "kosdaq": kosdaq}, "sectors": sectors, "global": global_}


# ──────────────────────────────────────────────
# 종목 현재가
# ──────────────────────────────────────────────
@app.get("/api/stock/{code}/price", summary="종목 현재가")
async def get_stock_price(code: str):
    """
    6자리 종목 코드로 현재가를 조회합니다.
    예) 005930 = 삼성전자
    """
    return await kis.fetch_stock_price(code)


@app.get("/api/stock/batch/prices", summary="복수 종목 현재가")
async def get_batch_prices(codes: str = Query(..., description="쉼표 구분 종목코드, 예) 005930,000660,028300")):
    """최대 150개 종목 동시 조회"""
    code_list = list(dict.fromkeys(c.strip().lstrip("A") for c in codes.split(",") if c.strip()))[:150]
    return {"stocks": await kis.fetch_batch_prices(code_list)}


@app.get("/api/stock/{code}/detail", summary="종목 상세")
async def get_stock_detail(code: str):
    """현재가와 시가·고가·저가, 52주 고저, 시가총액, PER/PBR"""
    d = await kis.fetch_stock_detail(code)
    if not d:
        raise HTTPException(503, "시세 조회 실패")
    return d


@app.get("/api/stock/{code}/orderbook", summary="호가")
async def get_orderbook(code: str):
    """10단계 매도·매수 호가와 잔량"""
    d = await kis.fetch_orderbook(code)
    if not d:
        raise HTTPException(503, "호가 조회 실패")
    return {**d, "next_ms": kis.poll_hint()}   # 클라이언트 갱신 간격 권장값


@app.get("/api/stock/{code}/chart", summary="종목 차트")
async def get_stock_chart(code: str, period: str = Query("D", description="1m/3m/5m/10m/30m/60m (당일 분봉) · D/W/M/Y (일/주/월/년봉)")):
    if period.endswith("m") and period[:-1].isdigit():
        n = int(period[:-1])
        if n not in (1, 3, 5, 10, 30, 60):
            raise HTTPException(400, "분봉은 1, 3, 5, 10, 30, 60분만 지원합니다.")
        return {"period": period, "candles": kis.aggregate_minutes(await kis.fetch_minute_chart(code), n)}
    if period not in ("D", "W", "M", "Y"):
        raise HTTPException(400, "period는 1m/3m/5m/10m/30m/60m 또는 D/W/M/Y 입니다.")
    return {"period": period, "candles": await kis.fetch_daily_chart(code, period)}


@app.get("/api/index/{code}/chart", summary="지수 차트")
async def get_index_chart(code: str, period: str = Query("D", description="D / W / M / Y")):
    """code: 0001=코스피, 1001=코스닥"""
    return {"period": period, "candles": await kis.fetch_daily_chart(code, period, is_index=True)}


# ──────────────────────────────────────────────
# 뉴스
# ──────────────────────────────────────────────
@app.get("/api/stock/{code}/news", summary="종목 뉴스")
async def get_stock_news(code: str, name: str = Query("", description="종목명"), count: int = Query(10, ge=1, le=30)):
    """종목명으로 검색한 최신 뉴스 (제목·매체·시각·링크)"""
    stock_name = name
    if not stock_name:
        d = await kis.fetch_stock_price(code)
        stock_name = d.get("name") or code
    return {"news": await news.stock_news(stock_name, count)}


@app.get("/api/news", summary="통합 뉴스")
async def get_market_news(topic: str = Query("market", description="market / feature / global / economy"), count: int = Query(30, ge=1, le=50)):
    """시장 뉴스. 특징주 기사가 없으면(휴장일 등) 증시 뉴스로 대체하고 fallback 으로 알린다"""
    items = await news.market_news(topic, count)
    fallback = None
    if not items and topic == "feature":
        items, fallback = await news.market_news("market", count), "market"
    return {"topic": topic, "fallback": fallback, "news": items}


@app.get("/api/news/headlines", summary="주요 뉴스")
async def get_headlines(count: int = Query(5, ge=1, le=10)):
    return {"news": await news.headlines(count)}


@app.get("/api/market/calendar", summary="시장 일정")
async def get_calendar(days: int = Query(60, ge=7, le=90)):
    """휴장·공모주 청약/상장·배당 기준일·주주총회·무상증자·감자·합병/분할"""
    return {"events": await market_events.fetch_calendar(days)}


@app.get("/api/stock/{code}/events", summary="종목 일정")
async def get_stock_events(code: str, days: int = Query(90, ge=7, le=180)):
    """배당 기준일·주주총회·무상증자·감자·합병 등 해당 종목의 예정 일정"""
    return {"events": await market_events.fetch_stock_events(code, days)}


@app.get("/api/stock/{code}/limit-ups", summary="상한가 기록")
async def get_limit_ups(code: str, years: int = Query(2, ge=1, le=3)):
    """최근 N년 상한가·하한가 마감일"""
    return await market_events.fetch_limit_ups(code, years)


# ──────────────────────────────────────────────
# 랭킹
# ──────────────────────────────────────────────
@app.get("/api/ranking/amount", summary="거래대금 상위")
async def ranking_amount(
    market: str = Query("all", description="all / kospi / kosdaq"),
):
    """거래대금 기준 상위 종목"""
    m = "J" if market == "kospi" else ("Q" if market == "kosdaq" else "all")
    return {"ranking": await kis.fetch_volume_rank(m, "amount")}


@app.get("/api/ranking/volume", summary="거래량 상위")
async def ranking_volume(
    market: str = Query("all", description="all / kospi / kosdaq"),
):
    """거래량 기준 상위 종목"""
    m = "J" if market == "kospi" else ("Q" if market == "kosdaq" else "all")
    return {"ranking": await kis.fetch_volume_rank(m, "volume")}


@app.get("/api/ranking/change", summary="등락률 상위")
async def ranking_change(
    direction: str = Query("up", description="up (상승률) / down (하락률)"),
):
    """상승률 또는 하락률 기준 상위 종목"""
    if direction not in ("up", "down"):
        raise HTTPException(400, "direction은 'up' 또는 'down'이어야 합니다.")
    return {"ranking": await kis.fetch_change_rank(direction)}


# ──────────────────────────────────────────────
# WebSocket — 실시간 가격 스트림
# ──────────────────────────────────────────────
@app.websocket("/ws/prices")
async def ws_prices(websocket: WebSocket):
    """
    실시간 체결가 WebSocket 엔드포인트.

    연결 후 서버는 1~2초 간격으로 아래 형식의 JSON을 전송합니다:
    ```json
    {
      "type": "price",
      "data": {
        "code": "005930",
        "price": 70300,
        "change": 1500,
        "change_rate": 2.18,
        "volume": 8120544,
        "trading_value": 571075702200
      }
    }
    ```
    클라이언트에서 메시지 전송:
    ```json
    {"action": "ping"}
    ```
    """
    await manager.connect(websocket)
    await websocket.send_json({
        "type": "status",
        "source": "live" if kis._is_configured() else "demo",
        "mode": kis.KIS_MODE,
    })
    try:
        while True:
            # 클라이언트 핑 수신 (연결 유지)
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if msg:
                    data = json.loads(msg)
                    if data.get("action") == "ping":
                        await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                pass
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


# ──────────────────────────────────────────────
# 익명 사용 통계 · 의견 보내기
# ──────────────────────────────────────────────
class StatsIn(BaseModel):
    v: str = ""
    pages: dict = {}
    events: dict = {}


class FeedbackIn(BaseModel):
    text: str
    contact: str = ""
    page: str = ""


@app.post("/api/stats", include_in_schema=False)
async def post_stats(body: StatsIn):
    pages = {k: v for k, v in body.pages.items() if isinstance(v, list) and len(v) == 2}
    await stats.record(body.v, pages, body.events)
    return {"ok": True}


@app.post("/api/feedback", summary="의견 보내기")
async def post_feedback(body: FeedbackIn, request: Request):
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "")
    ok, msg = await stats.add_feedback(body.text, body.contact, body.page, ip)
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True}


@app.get("/api/admin/stats", include_in_schema=False)
async def admin_stats(days: int = 14, x_admin_key: str = Header("")):
    # 띄어쓰기·하이픈·대소문자 차이는 무시 (손으로 옮겨 적을 때 실수 방지)
    norm = lambda v: re.sub(r"[\s-]", "", v or "").upper()
    key = norm(os.getenv("ADMIN_KEY", ""))
    if not key or norm(x_admin_key) != key:
        raise HTTPException(401, "관리자 키가 올바르지 않습니다.")
    return await stats.summary(days)


# ──────────────────────────────────────────────
# 토큰 상태 (디버그용)
# ──────────────────────────────────────────────
@app.get("/api/token/status", include_in_schema=False)
async def token_status():
    import time
    cache = kis._token_cache
    return {
        "mode":       kis.KIS_MODE,
        "configured": kis._is_configured(),
        "has_token":  bool(cache["access_token"]),
        "expires_in": max(0, int(cache["expires_at"] - time.time())),
        "shared_store": bool(kis._REDIS_URL),
        "last_errors": kis.last_errors,
    }


# ──────────────────────────────────────────────
# 엔트리포인트
# ──────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
