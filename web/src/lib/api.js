// 백엔드(Vercel) 주소. 개발 중 다른 서버를 쓰려면 .env 에 VITE_API_URL 지정
export const API_BASE = import.meta.env.VITE_API_URL || 'https://drmarket-api.vercel.app'

export async function api(path, { timeout = 20000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(API_BASE + path, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export const getHealth = () => api('/health', { timeout: 10000 })
export const getIndices = () => api('/api/market/indices')
export const getBatchPrices = (codes) => api(`/api/stock/batch/prices?codes=${codes.join(',')}`, { timeout: 30000 })
export const getRanking = (type) =>
  api(type === 'down' ? '/api/ranking/change?direction=down' : `/api/ranking/${type === 'up' ? 'change' : type}`)
export const getOrderbook = (code) => api(`/api/stock/${code}/orderbook`, { timeout: 10000 })
export const getDetail = (code) => api(`/api/stock/${code}/detail`)
export const getStockChart = (code, period) => api(`/api/stock/${code}/chart?period=${period}`, { timeout: 30000 })
export const getIndexChart = (code, period) => api(`/api/index/${code}/chart?period=${period}`)
export const getNews = (code, name) => api(`/api/stock/${code}/news?name=${encodeURIComponent(name)}&count=6`)
