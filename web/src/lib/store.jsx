import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import THEMES from '../data/themes.json'
import { getBatchPrices, getHealth, getIndices, getStocks } from './api'
import { marketPhase } from './format'
import { buildMatcher } from './stocks'

const MarketContext = createContext(null)
export const useMarket = () => useContext(MarketContext)

const THEME_CODES = [...new Set(THEMES.flatMap((t) => t.stocks))]

// ── localStorage (실패해도 앱은 동작) ──
const load = (key, fallback) => {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

// 마지막으로 받은 시세·지수·종목 목록: 다음에 앱을 열 때 서버 응답을 기다리지 않고 먼저 보여 준다
const SNAP_KEY = 'drm.snapshot'
const snapshot = load(SNAP_KEY, null)
const cachedStocks = load('drm.stocks', [])

function loadFavorites() {
  // 이전 버전은 'A005930' 형식으로 저장했으므로 앞의 A를 제거해 이어받음
  const v2 = load('drm.favorites', null)
  if (v2) return v2
  return load('drmarket_favs', []).map((c) => String(c).replace(/^A/, ''))
}

function loadMemos() {
  const v2 = load('drm.memos', null)
  if (v2) return v2
  const old = load('drmarket_memos', {})
  return Object.fromEntries(Object.entries(old).map(([k, v]) => [k.replace(/^A/, ''), v]))
}

export function MarketProvider({ children }) {
  const [prices, setPrices] = useState(() => snapshot?.prices || {})          // code → 시세
  const [flash, setFlash] = useState({})            // code → 'up' | 'down' (가격 변동 깜빡임)
  const [indices, setIndices] = useState(() => snapshot?.indices || [])
  const [status, setStatus] = useState('connecting') // connecting | live | error | demo
  const [updatedAt, setUpdatedAt] = useState(null)
  const [stockList, setStockList] = useState(() => (Array.isArray(cachedStocks) ? cachedStocks : []))    // [[code, name, market]]
  const [favorites, setFavorites] = useState(loadFavorites)
  const [memos, setMemos] = useState(loadMemos)
  const prevPrices = useRef({})
  // 화면에서 추가로 보고 있는 종목: code → { n: 보고 있는 화면 수, fast: 빠른 갱신 화면 수, until: 화면을 떠난 뒤 유지 시각 }
  const watchers = useRef(new Map())

  useEffect(() => save('drm.favorites', favorites), [favorites])
  useEffect(() => save('drm.memos', memos), [memos])
  // 시세 기억은 5초에 한 번만 저장 (1.5초마다 쓰지 않도록)
  const snapTimer = useRef(null)
  const snapData = useRef(null)
  useEffect(() => {
    if (!Object.keys(prices).length && !indices.length) return
    snapData.current = { prices, indices, at: Date.now() }
    if (snapTimer.current) return
    snapTimer.current = setTimeout(() => { snapTimer.current = null; save(SNAP_KEY, snapData.current) }, 5000)
  }, [prices, indices])

  useEffect(() => {
    // 사이트에 함께 배포된 목록으로 먼저 띄우고, 서버의 최신 목록(신규 상장·폐지·사명 변경 반영)으로 바꿈
    let fresh = false
    fetch('./stocks.json', { cache: 'no-cache' })
      .then((r) => r.json())
      .then((list) => { if (!fresh && Array.isArray(list) && list.length > 1000) setStockList(list) })
      .catch(() => {})
    getStocks()
      .then((list) => { if (Array.isArray(list) && list.length > 1000) { fresh = true; setStockList(list); save('drm.stocks', list) } })
      .catch(() => {})
  }, [])

  const findStocks = useMemo(() => buildMatcher(stockList), [stockList])

  const stockMap = useMemo(() => {
    const m = {}
    for (const [code, name, market] of stockList) m[code] = { code, name, market: market === 'P' ? '코스피' : '코스닥' }
    return m
  }, [stockList])

  const watchedCodes = (fastOnly) => {
    const now = Date.now()
    const out = []
    for (const [code, w] of watchers.current) {
      if (fastOnly ? w.fast > 0 : w.n > 0 || now < w.until) out.push(code)
      else if (!fastOnly && w.n <= 0 && now >= w.until) watchers.current.delete(code)
    }
    return out
  }

  // 받은 시세를 반영하고 바뀐 종목은 잠깐 깜빡임
  const applyPrices = useCallback((result) => {
    const changed = {}
    for (const [code, s] of Object.entries(result)) {
      const before = prevPrices.current[code]
      if (before !== undefined && before !== s.price) changed[code] = s.price > before ? 'up' : 'down'
      prevPrices.current[code] = s.price
    }
    setPrices((p) => ({ ...p, ...result }))
    if (Object.keys(changed).length) {
      setFlash(changed)
      setTimeout(() => setFlash({}), 600)
    }
    setUpdatedAt(new Date())
  }, [])

  const fetchPrices = async (codes) => {
    const result = {}
    const chunks = []
    for (let i = 0; i < codes.length; i += 150) chunks.push(codes.slice(i, i + 150))
    const all = await Promise.all(chunks.map((c) => getBatchPrices(c)))   // 나눠 받을 때도 동시에
    for (const data of all) {
      for (const s of data.stocks || []) {
        if (s.source === 'live' && s.price > 0) result[s.code] = s
      }
    }
    return result
  }

  const refreshPrices = useCallback(async () => {
    const codes = [...new Set([...THEME_CODES, ...favorites, ...watchedCodes(false)])]
    const result = await fetchPrices(codes)
    if (!Object.keys(result).length) {
      setStatus((st) => (st === 'demo' ? st : 'error'))
      return false
    }
    setStatus((st) => (st === 'demo' ? st : 'live'))
    applyPrices(result)
    return true
  }, [favorites, applyPrices])

  // 지금 보고 있는 종목(종목 화면)은 1.5초마다 따로 갱신
  const refreshFast = useCallback(async () => {
    const codes = watchedCodes(true)
    if (!codes.length) return
    const result = await fetchPrices(codes)
    if (Object.keys(result).length) applyPrices(result)
  }, [applyPrices])

  const refreshIndices = useCallback(async () => {
    const d = await getIndices()
    const live = (d.indices || []).filter((i) => i.source === 'live')
    if (!live.length) throw new Error('no live index')
    setIndices(live)
  }, [])

  // 폴링: 시세는 장중 3초(보고 있는 종목은 1.5초) / 장외 60초, 지수는 장중 5초
  // 간격은 요청 시작 기준이라 응답 시간만큼 늦어지지 않음
  useEffect(() => {
    let stopped = false
    let priceTimer, indexTimer, fastTimer
    const after = (started, every) => Math.max(500, every - (Date.now() - started))

    let first = true
    const tickPrices = async () => {
      const started = Date.now()
      let ok = true
      // 첫 조회는 탭이 백그라운드여도 실행, 이후에는 보이는 동안만
      if (first || document.visibilityState === 'visible') {
        first = false
        try {
          ok = await refreshPrices()
        } catch {
          ok = false
          if (!stopped) setStatus((s) => (s === 'demo' ? s : 'error'))
        }
      }
      // 실패하면 5초 뒤 재시도, 성공하면 장중 5초 / 장외 60초
      if (!stopped) priceTimer = setTimeout(tickPrices, !ok ? 5000 : marketPhase().key === 'open' ? after(started, 3000) : 60000)
    }
    const tickFast = async () => {
      const started = Date.now()
      if (document.visibilityState === 'visible' && marketPhase().key === 'open') await refreshFast().catch(() => {})
      if (!stopped) fastTimer = setTimeout(tickFast, after(started, 1500))
    }
    let firstIndex = true
    const tickIndices = async () => {
      const started = Date.now()
      let ok = true
      if (firstIndex || document.visibilityState === 'visible') {
        firstIndex = false
        ok = await refreshIndices().then(() => true).catch(() => false)
      }
      if (!stopped) indexTimer = setTimeout(tickIndices, !ok ? 6000 : marketPhase().key === 'open' ? after(started, 5000) : 60000)
    }

    // 서버 상태 확인을 기다리지 않고 바로 시세부터 받음 (첫 화면이 한 번 왕복만큼 빨라짐)
    tickPrices()
    tickIndices()
    tickFast()
    getHealth()
      .then((h) => { if (!h.api_configured) setStatus('demo') })
      .catch(() => {})

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshPrices().catch(() => {})
        refreshIndices().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(priceTimer)
      clearTimeout(indexTimer)
      clearTimeout(fastTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshPrices, refreshIndices, refreshFast])

  // 테마별 집계: 평균 등락률, 상승/하락 종목 수, 대장주
  const themes = useMemo(
    () =>
      THEMES.map((t) => {
        const stocks = t.stocks
          .map((code) => ({ code, name: stockMap[code]?.name || prices[code]?.name || code, ...prices[code] }))
          .sort((a, b) => (b.change_rate ?? -999) - (a.change_rate ?? -999))
        const live = stocks.filter((s) => s.price)
        const avg = live.length ? live.reduce((sum, s) => sum + s.change_rate, 0) / live.length : null
        const value = live.reduce((sum, s) => sum + (s.trading_value || 0), 0)   // 테마 당일 거래대금 합
        return {
          ...t,
          stocks,
          avg,
          value,
          up: live.filter((s) => s.change_rate > 0).length,
          down: live.filter((s) => s.change_rate < 0).length,
          leader: live[0] || null,
        }
      }),
    [prices, stockMap],
  )

  const toggleFavorite = useCallback(
    (code) => setFavorites((f) => (f.includes(code) ? f.filter((c) => c !== code) : [code, ...f])),
    [],
  )
  const setMemo = useCallback((code, text) => setMemos((m) => ({ ...m, [code]: text })), [])
  // watch(code, fast) → 화면을 떠날 때 부르는 해제 함수. 새 종목이 생기면 잠깐 모았다가 한 번만 조회
  const pendingRefresh = useRef(null)
  const refreshRef = useRef(refreshPrices)
  refreshRef.current = refreshPrices
  const watch = useCallback((code, fast = false) => {
    const m = watchers.current
    const w = m.get(code) || { n: 0, fast: 0, until: 0 }
    const isNew = w.n <= 0 && Date.now() >= w.until
    w.n += 1
    if (fast) w.fast += 1
    m.set(code, w)
    if (isNew && !pendingRefresh.current) {
      pendingRefresh.current = setTimeout(() => {
        pendingRefresh.current = null
        refreshRef.current().catch(() => {})
      }, 80)
    }
    return () => {
      w.n -= 1
      if (fast) w.fast -= 1
      if (w.n <= 0) w.until = Date.now() + 30000   // 바로 다시 볼 수 있어 30초는 유지
    }
  }, [])

  const value = {
    prices, flash, indices, status, updatedAt, themes, stockMap, stockList, findStocks,
    favorites, toggleFavorite, memos, setMemo, watch,
    refresh: () => Promise.all([refreshPrices(), refreshIndices()]).catch(() => {}),
  }
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
}

export const themesOfStock = (code) => THEMES.filter((t) => t.stocks.includes(code))
