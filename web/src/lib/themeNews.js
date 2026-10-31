import { useEffect, useState } from 'react'
import THEMES from '../data/themes.json'
import { api } from './api'

// 주제별 오늘의 주요 기사 1건 (테마 id, "mkt:kospi" 같은 시장 id, "sector:업종명")
// 앱 전체에서 공유하고 5분이 지난 항목만 다시 받는다.
const cache = new Map()      // id → { item, at }
const listeners = new Set()
let pending = new Set()
let timer = null
const TTL = 300000
const SAVE_KEY = 'drm.themeNews'

// 지난번 기사를 기억해 두었다가 앱을 열자마자 보여 줌 (at: 0 → 바로 다시 받음)
try {
  for (const [id, item] of Object.entries(JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'))) cache.set(id, { item, at: 0 })
} catch {}

function notify() {
  listeners.forEach((fn) => fn())
  try {
    const out = {}
    for (const [id, c] of cache) if (c.item) out[id] = c.item
    localStorage.setItem(SAVE_KEY, JSON.stringify(out))
  } catch {}
}

function flush() {
  timer = null
  const ids = [...pending]
  pending = new Set()
  if (!ids.length) return
  api(`/api/news/themes?ids=${ids.map(encodeURIComponent).join(',')}`, { timeout: 40000 })
    .then((d) => {
      const now = Date.now()
      for (const id of ids) cache.set(id, { item: d.news?.[id] || null, at: now })
      notify()
    })
    .catch(() => {})
}

function request(ids) {
  const now = Date.now()
  for (const id of ids) {
    const c = cache.get(id)
    if (!c || now - c.at > TTL) pending.add(id)
  }
  if (pending.size && !timer) timer = setTimeout(flush, 50)   // 같은 순간의 요청을 한 번으로 묶음
}

export function useKeyNews(ids) {
  const key = ids.join('|')
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick((t) => t + 1)
    listeners.add(fn)
    request(ids)
    const t = setInterval(() => { if (document.visibilityState === 'visible') request(ids) }, TTL)
    return () => { listeners.delete(fn); clearInterval(t) }
  }, [key])
  const out = {}
  // 아직 받지 않았으면 undefined, 받았는데 기사가 없으면 null
  for (const id of ids) out[id] = cache.has(id) ? cache.get(id).item : undefined
  return out
}

const THEME_IDS = THEMES.map((t) => t.id)
export function useThemeNews() {
  return useKeyNews(THEME_IDS)
}
