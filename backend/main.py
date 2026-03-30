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
from contextlib import asynccontextmanager
from datetime import datetime

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

import kis_client as kis

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
    "005930","000660","373220","207940","028300",
    "068270","042660","012450","035420","035720",
    "097230","036800","950200","058990","302430",
    "352820","009540",
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
    <li><span class="tag">GET</span><code>/api/market/indices</code> — 시장 지수 (코스피, 코스닥, 나스닥 등)</li>
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
    """최대 20개 종목 동시 조회"""
    code_list = [c.strip() for c in codes.split(",")][:20]
    results = await asyncio.gather(*[kis.fetch_stock_price(c) for c in code_list])
    return {"stocks": list(results)}


# ──────────────────────────────────────────────
# 뉴스
# ──────────────────────────────────────────────
@app.get("/api/stock/{code}/news", summary="종목 뉴스")
async def get_stock_news(
    code: str,
    name: str = Query("", description="종목명 (뉴스 검색용)"),
    count: int = Query(5, ge=1, le=20),
):
    """
    종목 관련 뉴스를 반환합니다.
    NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수 설정 시 네이버 뉴스 API 사용.
    """
    stock_name = name or code
    if not name:
        # 종목명 조회 시도
        try:
            price_data = await kis.fetch_stock_price(code)
            stock_name = price_data.get("name", code)
        except Exception:
            pass
    return {"news": await kis.fetch_stock_news(stock_name, count)}


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


@app.get("/api/ranking/views", summary="조회수 상위 (시뮬레이션)")
async def ranking_views():
    """
    조회수 기준 인기 종목 (시뮬레이션).
    실제 증권사 내부 데이터라 공개 API 미제공.
    """
    base = await kis.fetch_volume_rank("all", "amount")
    # 조회수 = 거래대금 기반 가중 시뮬레이션
    for item in base:
        item["views"] = random.randint(
            int(item["trading_value"] / 1_000_000),
            int(item["trading_value"] / 500_000),
        )
    base.sort(key=lambda x: x["views"], reverse=True)
    for i, r in enumerate(base):
        r["rank"] = i + 1
    return {"ranking": base}


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
    }


# ──────────────────────────────────────────────
# 엔트리포인트
# ──────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
