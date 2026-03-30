# 닥터마켓 백엔드 서버

한국투자증권 Open API 기반 실시간 주식 정보 서버입니다.
Railway에 무료로 배포할 수 있습니다.

---

## 빠른 시작 (Railway 배포)

### 1단계 — 한국투자증권 API 키 발급

1. [한국투자증권 Open API 포털](https://apiportal.koreainvestment.com) 접속
2. 회원가입 / 로그인 (계좌 없어도 **모의투자** 계정으로 시작 가능)
3. **앱 등록** → 앱 이름 입력 → **App Key / App Secret** 복사

> 모의투자 API Key로 대부분의 시세 조회 기능을 무료로 테스트할 수 있습니다.

---

### 2단계 — GitHub 리포지토리 생성

```bash
# backend/ 폴더를 별도 리포지토리로 만들기
cd backend
git init
git add .
git commit -m "init: 닥터마켓 API 서버"
git remote add origin https://github.com/your-id/drmarket-api.git
git push -u origin main
```

---

### 3단계 — Railway 배포

1. [railway.app](https://railway.app) 접속 → GitHub 로그인
2. **New Project** → **Deploy from GitHub repo** → 위 리포 선택
3. Railway가 `Dockerfile`을 자동 감지하여 빌드·배포

---

### 4단계 — 환경변수 설정

Railway 대시보드 → 프로젝트 → **Variables** 탭에서 아래 값 입력:

| 변수명 | 설명 | 예시 |
|--------|------|------|
| `KIS_MODE` | `paper` (모의) 또는 `real` (실전) | `paper` |
| `KIS_PAPER_APP_KEY` | 모의투자 App Key | `PSxxxxxxxxxxxxxxxx` |
| `KIS_PAPER_APP_SECRET` | 모의투자 App Secret | `xxxxxxxxxxxxxxxx...` |
| `KIS_APP_KEY` | 실전투자 App Key (실전 시) | |
| `KIS_APP_SECRET` | 실전투자 App Secret (실전 시) | |
| `NAVER_CLIENT_ID` | 네이버 뉴스 API ID (선택) | |
| `NAVER_CLIENT_SECRET` | 네이버 뉴스 API Secret (선택) | |
| `ALLOWED_ORIGINS` | CORS 허용 출처 | `*` |

---

### 5단계 — 프론트엔드 연결

Railway 배포 완료 후 생성된 URL (예: `https://drmarket-api.up.railway.app`)을
`index.html` 브라우저 콘솔에서 한 번만 실행하면 됩니다:

```javascript
localStorage.setItem('drmarket_api', 'https://drmarket-api.up.railway.app')
location.reload()
```

이후 새로고침하면 헤더에 **🟢 실시간 연결됨** 표시가 나타납니다.

---

## API 엔드포인트

배포 후 `https://your-url.railway.app/docs` 에서 Swagger UI로 전체 문서 확인 가능합니다.

| Method | Path | 설명 |
|--------|------|------|
| GET | `/health` | 서버 상태 확인 |
| GET | `/api/market/indices` | 코스피·코스닥·나스닥 등 지수 |
| GET | `/api/stock/{code}/price` | 종목 현재가 (예: `005930`) |
| GET | `/api/stock/batch/prices?codes=005930,000660` | 복수 종목 현재가 |
| GET | `/api/stock/{code}/news?name=삼성전자` | 종목 뉴스 |
| GET | `/api/ranking/amount` | 거래대금 상위 |
| GET | `/api/ranking/volume` | 거래량 상위 |
| GET | `/api/ranking/change?direction=up` | 상승률 상위 |
| GET | `/api/ranking/change?direction=down` | 하락률 상위 |
| GET | `/api/ranking/views` | 조회수 상위 |
| WS  | `/ws/prices` | 실시간 체결가 스트림 |

---

## 로컬 실행 (테스트용)

```bash
cd backend

# 가상환경 생성
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt

# .env 파일 생성
cp .env.example .env
# .env 파일을 열어 API 키 입력

# 서버 실행
python main.py
# → http://localhost:8000
```

---

## 아키텍처

```
[한국투자증권 API]
    │
    │  REST  → 현재가 / 순위 / 지수
    │  WSS   → 실시간 체결가 (H0STCNT0)
    ▼
[FastAPI 서버 on Railway]
    │  토큰 자동 갱신 (24h)
    │  API 실패 시 시뮬레이션 자동 폴백
    │
    ├── GET  /api/*      → REST 응답
    └── WS   /ws/prices  → 브로드캐스트 (연결된 모든 클라이언트)
              │
    ┌─────────┴──────────┐
    │  브라우저 클라이언트들  │
    │   닥터마켓 index.html │
    └────────────────────┘
```

---

## 필요한 추가 작업 (선택)

| 기능 | 방법 |
|------|------|
| 네이버 뉴스 실시간화 | [네이버 개발자센터](https://developers.naver.com/apps) 에서 검색 API 신청 (무료, 일 25,000건) |
| 상한가 내역 | KRX 공시 API 또는 자체 DB 적재 |
| 미니 차트 (분봉) | KIS `/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice` |
| 알림 기능 | FCM(Firebase) + 즐겨찾기 종목 가격 감시 |
