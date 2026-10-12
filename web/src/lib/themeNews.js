import { useEffect, useState } from 'react'
import THEMES from '../data/themes.json'
import { api } from './api'

// 테마별 오늘의 주요 기사 1건. 앱 전체에서 한 번만 받아 공유하고 5분마다 갱신
let cache = null
let loading = null
const listeners = new Set()

async function load() {
  if (loading) return loading
  loading = api(`/api/news/themes?ids=${THEMES.map((t) => t.id).join(',')}`, { timeout: 40000 })
    .then((d) => { cache = d.news || {}; listeners.forEach((fn) => fn(cache)) })
    .catch(() => {})
    .finally(() => { loading = null })
  return loading
}

setInterval(() => { if (document.visibilityState === 'visible') load() }, 300000)

export function useThemeNews() {
  const [news, setNews] = useState(cache || {})
  useEffect(() => {
    listeners.add(setNews)
    if (!cache) load()
    return () => listeners.delete(setNews)
  }, [])
  return news
}
