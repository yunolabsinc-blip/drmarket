// 백엔드(Vercel) 주소. 개발 중 다른 서버를 쓰려면 .env 에 VITE_API_URL 지정
export const API_BASE = import.meta.env.VITE_API_URL || 'https://drmarket-api.vercel.app'

// 마지막으로 받은 응답을 기억해 두고, 화면을 열 때 서버를 기다리지 않고 먼저 보여 준다 (뒤에서 새로 받아 바꿈)
// 뉴스·순위·시장종합·일정·종목 정보처럼 자주 다시 여는 것만 이 기기에 저장 (시세·차트·호가는 따로 처리)
const SAVE_KEY = 'drm.api'
const SAVE_MAX = 60
const SAVE_RE = /^\/api\/(news|ranking|market\/(overview|calendar)|stock\/\d{6}\/(detail|news|events|limit-ups))/
const mem = new Map()
let saved = {}
try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {} } catch {}
let saveTimer = null

export const peek = (path) => mem.get(path) ?? saved[path]?.d

function remember(path, data) {
  mem.set(path, data)
  if (!SAVE_RE.test(path)) return
  saved[path] = { d: data, at: Date.now() }
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const keys = Object.keys(saved).sort((a, b) => saved[b].at - saved[a].at)
    for (const k of keys.slice(SAVE_MAX)) delete saved[k]
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)) } catch {
      // 저장 공간이 모자라면 오래된 절반을 버리고 다시
      for (const k of keys.slice(keys.length >> 1)) delete saved[k]
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)) } catch {}
    }
  }, 1000)
}

// 경로를 만드는 함수 → 조회 함수 + .peek(마지막 응답)
const endpoint = (build, opts) => Object.assign((...a) => api(build(...a), opts), { peek: (...a) => peek(build(...a)) })

export async function api(path, { timeout = 20000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(API_BASE + path, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    remember(path, data)
    return data
  } finally {
    clearTimeout(timer)
  }
}

export const getStocks = () => api('/api/stocks', { timeout: 30000 })
export const getHealth = () => api('/health', { timeout: 10000 })
export const getIndices = () => api('/api/market/indices')
export const getBatchPrices = (codes) => api(`/api/stock/batch/prices?codes=${codes.join(',')}`, { timeout: 30000 })
export const getRanking = endpoint((type) =>
  type === 'down' ? '/api/ranking/change?direction=down' : `/api/ranking/${type === 'up' ? 'change' : type}`)
export const getOrderbook = (code) => api(`/api/stock/${code}/orderbook`, { timeout: 10000 })
export const getMarketOverview = endpoint(() => '/api/market/overview', { timeout: 30000 })
export const getDetail = endpoint((code) => `/api/stock/${code}/detail`)
export const getStockChart = (code, period, quick) => api(`/api/stock/${code}/chart?period=${period}${quick ? '&quick=1' : ''}`, { timeout: 30000 })
export const getIndexChart = endpoint((code, period) => `/api/index/${code}/chart?period=${period}`)
export const getMarketNews = endpoint((topic) => `/api/news?topic=${topic}`)
export const getHeadlines = endpoint((count = 5) => `/api/news/headlines?count=${count}`)
export const getCalendar = endpoint(() => '/api/market/calendar', { timeout: 40000 })
export const getStockEvents = endpoint((code) => `/api/stock/${code}/events`, { timeout: 40000 })
export const getLimitUps = endpoint((code) => `/api/stock/${code}/limit-ups`, { timeout: 40000 })
export const getNews = endpoint((code, name) => `/api/stock/${code}/news?name=${encodeURIComponent(name)}&count=6`)
