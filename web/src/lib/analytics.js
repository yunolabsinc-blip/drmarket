// 익명 사용 통계: 화면별 조회 수·체류 시간·주요 기능 사용 횟수만 모아서 보낸다.
// 이름·연락처·기기 정보는 보내지 않는다. 방문자 구분용 무작위 ID는 이 브라우저에만 저장된다.
import { API_BASE } from './api'

const VID_KEY = 'drm.vid'
let visitor = ''
try {
  visitor = localStorage.getItem(VID_KEY) || ''
  if (!visitor) {
    visitor = (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
    localStorage.setItem(VID_KEY, visitor)
  }
} catch {}

let pages = {}        // { page: [views, secs] }
let events = {}       // { name: count }
let current = null    // { page, since }

const pageKey = (route) => {
  if (route.page === 'market' && (route.param === 'news' || route.param === 'calendar')) return `market/${route.param}`
  return route.page || 'home'
}

function closeCurrent() {
  if (!current) return
  const secs = Math.round((Date.now() - current.since) / 1000)
  const p = (pages[current.page] ||= [0, 0])
  p[1] += Math.min(secs, 1800)   // 자리를 비운 시간은 30분까지만
  current = null
}

export function trackPage(route) {
  closeCurrent()
  const page = pageKey(route)
  if (page === 'admin') return
  const p = (pages[page] ||= [0, 0])
  p[0] += 1
  current = { page, since: Date.now() }
}

export function track(name) {
  events[name] = (events[name] || 0) + 1
}

function flush() {
  const resume = current?.page
  closeCurrent()
  if (resume && document.visibilityState === 'visible') current = { page: resume, since: Date.now() }
  if (!Object.keys(pages).length && !Object.keys(events).length) return
  const body = JSON.stringify({ v: visitor, pages, events })
  pages = {}
  events = {}
  // sendBeacon은 항상 쿠키를 붙여 보내서, 서버의 CORS 응답(*)이 브라우저에서 막힘
  // → 쿠키 없이 보내는 keepalive fetch를 쓰고(화면을 닫아도 전송됨), 안 될 때만 sendBeacon
  try {
    fetch(`${API_BASE}/api/stats`, {
      method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit',
    }).catch(() => {})
  } catch {
    try { navigator.sendBeacon?.(`${API_BASE}/api/stats`, new Blob([body], { type: 'application/json' })) } catch {}
  }
}

// 화면을 떠나거나 백그라운드로 갈 때, 그리고 2분마다 전송
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush()
  else if (!current && lastRoute) trackResume()
})
window.addEventListener('pagehide', flush)
setInterval(flush, 120000)

let lastRoute = null
function trackResume() {
  const page = pageKey(lastRoute)
  if (page !== 'admin') current = { page, since: Date.now() }
}
export function setRoute(route) {
  lastRoute = route
  trackPage(route)
}
