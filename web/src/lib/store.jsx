import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import THEMES from '../data/themes.json'
import { getBatchPrices, getHealth, getIndices } from './api'
import { marketPhase } from './format'

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
  const [prices, setPrices] = useState({})          // code → 시세
  const [flash, setFlash] = useState({})            // code → 'up' | 'down' (가격 변동 깜빡임)
  const [indices, setIndices] = useState([])
  const [status, setStatus] = useState('connecting') // connecting | live | error | demo
  const [updatedAt, setUpdatedAt] = useState(null)
  const [stockList, setStockList] = useState([])    // [[code, name, market]]
  const [favorites, setFavorites] = useState(loadFavorites)
  const [memos, setMemos] = useState(loadMemos)
  const prevPrices = useRef({})
  const extraCodes = useRef(new Set())              // 화면에서 추가로 보고 있는 종목

  useEffect(() => save('drm.favorites', favorites), [favorites])
  useEffect(() => save('drm.memos', memos), [memos])

  useEffect(() => {
    fetch('./stocks.json')
      .then((r) => r.json())
      .then(setStockList)
      .catch(() => {})
  }, [])

  const stockMap = useMemo(() => {
    const m = {}
    for (const [code, name, market] of stockList) m[code] = { code, name, market: market === 'P' ? '코스피' : '코스닥' }
    return m
  }, [stockList])

  const refreshPrices = useCallback(async () => {
    const codes = [...new Set([...THEME_CODES, ...favorites, ...extraCodes.current])]
    const result = {}
    for (let i = 0; i < codes.length; i += 150) {
      const data = await getBatchPrices(codes.slice(i, i + 150))
      for (const s of data.stocks || []) {
        if (s.source === 'live' && s.price > 0) result[s.code] = s
      }
    }
    if (!Object.keys(result).length) {
      setStatus((st) => (st === 'demo' ? st : 'error'))
      return false
    }
    setStatus((st) => (st === 'demo' ? st : 'live'))
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
    return true
  }, [favorites])

  const refreshIndices = useCallback(async () => {
    const d = await getIndices()
    const live = (d.indices || []).filter((i) => i.source === 'live')
    if (!live.length) throw new Error('no live index')
    setIndices(live)
  }, [])

  // 폴링: 시세는 장중 5초 / 장외 60초, 지수는 30초
  useEffect(() => {
    let stopped = false
    let priceTimer, indexTimer

    let first = true
    const tickPrices = async () => {
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
      if (!stopped) priceTimer = setTimeout(tickPrices, !ok || marketPhase().key === 'open' ? 5000 : 60000)
    }
    let firstIndex = true
    const tickIndices = async () => {
      let ok = true
      if (firstIndex || document.visibilityState === 'visible') {
        firstIndex = false
        ok = await refreshIndices().then(() => true).catch(() => false)
      }
      if (!stopped) indexTimer = setTimeout(tickIndices, ok ? 30000 : 6000)
    }

    ;(async () => {
      try {
        const h = await getHealth()
        if (!h.api_configured) {
          setStatus('demo')
          return
        }
      } catch {
        setStatus('error')
      }
      tickPrices()
      tickIndices()
    })()

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
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshPrices, refreshIndices])

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
  const watch = useCallback((code) => {
    if (!extraCodes.current.has(code)) {
      extraCodes.current.add(code)
      refreshPrices().catch(() => {})
    }
  }, [refreshPrices])

  const value = {
    prices, flash, indices, status, updatedAt, themes, stockMap, stockList,
    favorites, toggleFavorite, memos, setMemo, watch,
    refresh: () => Promise.all([refreshPrices(), refreshIndices()]).catch(() => {}),
  }
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
}

export const themesOfStock = (code) => THEMES.filter((t) => t.stocks.includes(code))
