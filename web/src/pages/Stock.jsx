import { useEffect, useState } from 'react'
import { themesOfStock, useMarket } from '../lib/store'
import { getDetail, getIndexChart, getLimitUps, getMarketOverview, getNews, getStockChart, getStockEvents, getWorldChart } from '../lib/api'
import { fmtChange, fmtIndex, fmtPrice, fmtRate, fmtVolume, fmtWonShort, marketPhase, tone } from '../lib/format'
import { go } from '../lib/router'
import Chart from '../components/Chart'
import OrderBook, { prefetchOrderbook } from '../components/OrderBook'
import { Disclaimer, Empty, Rate, StarIcon, SubBar } from '../components/ui'
import { NewsItems } from '../components/NewsList'
import { EventRows } from '../components/Calendar'
import { track } from '../lib/analytics'

// MTS 방식: 분봉(1·3·5·10·30·60) + 일·주·월·년봉
const MINUTES = [1, 3, 5, 10, 30, 60]
const MAIN_PERIODS = [
  { id: 'min', label: '분' },
  { id: 'D', label: '일' },
  { id: 'W', label: '주' },
  { id: 'M', label: '월' },
  { id: 'Y', label: '년' },
]
const INDEX_PERIODS = MAIN_PERIODS.slice(1)
const loadPeriod = (key, fallback) => { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
const savePeriod = (key, v) => { try { localStorage.setItem(key, v) } catch {} }

// 차트 데이터: 장중에는 분봉 5초, 일·주·월·년봉 60초마다 다시 받는다 (화면이 보일 때만)
// 받은 차트는 기억해 두어 기간을 바꾸거나 종목에 다시 들어올 때 빈 화면 없이 바로 그린다.
const chartCache = new Map()   // `${종류}:${코드}:${기간}` → candles
const CACHE_MAX = 60

function remember(id, candles) {
  chartCache.delete(id)
  chartCache.set(id, candles)
  if (chartCache.size > CACHE_MAX) chartCache.delete(chartCache.keys().next().value)
}

// 같은 종목의 다른 기간을 미리 받아 둔다 (분봉은 서버에서 1분봉 하나로 같이 만들어 1번이면 됨)
function prefetchCharts(fetcher, kind, key, periods) {
  // 가벼운 일·주·월·년봉 먼저, 분봉은 마지막 (분봉이 앞부분이면 미리 받기가 아니라 빈 상태로 남으니 기억하지 않음)
  periods.forEach((p, i) => {
    const id = `${kind}:${key}:${p}`
    if (chartCache.has(id)) return
    setTimeout(() => fetcher(key, p, true).then((d) => d?.candles && !d.partial && remember(id, d.candles)).catch(() => {}), 300 + i * 250)
  })
}

// 종목 줄을 누르는 순간(손가락이 닿을 때) 차트·상세를 먼저 요청 — 화면이 열릴 때 이미 오고 있게
const early = new Map()   // 차트 id → 진행 중인 요청 (2초 안에 화면이 열리면 그대로 이어 받음)
export function prefetchStock(code) {
  if (!/^\d{6}$/.test(code)) return
  const period = loadPeriod('drm.chartPeriod', 'D')
  const id = `stock:${code}:${period}`
  if (!chartCache.has(id) && !early.has(id)) {
    const req = getStockChart(code, period, true)
    req.catch(() => {})
    early.set(id, req)
    setTimeout(() => early.delete(id), 2000)
  }
  if (!getDetail.peek(code)) getDetail(code).catch(() => {})
}

function useChart(fetcher, key, period, kind = 'stock', prefetch = []) {
  const id = `${kind}:${key}:${period}`
  const [state, setState] = useState(() => ({ candles: chartCache.get(id) ?? null, error: false }))
  useEffect(() => {
    let alive = true
    let timer
    setState({ candles: chartCache.get(id) ?? null, error: false })
    const intraday = String(period).endsWith('m')
    // 분봉 첫 조회는 최근 2시간만 먼저 받고(partial), 서버가 나머지를 채우는 동안 곧바로 다시 받는다
    let partial = false
    const load = (first) => {
      if (!first && !partial && document.visibilityState !== 'visible') return schedule()
      const pre = first && early.get(id)
      if (pre) early.delete(id)
      ;(pre || fetcher(key, period, first || partial))
        .then((d) => {
          const candles = d.candles || []
          partial = !!d.partial
          if (candles.length && !partial) remember(id, candles)
          if (alive) setState((s) => (partial && s.candles?.length > candles.length ? s : { candles, error: false }))
          if (first && prefetch.length) prefetchCharts(fetcher, kind, key, prefetch.filter((p) => p !== period))
        })
        .catch(() => alive && first && setState((s) => (s.candles?.length ? s : { candles: [], error: true })))
        .finally(() => alive && schedule())
    }
    const schedule = () => {
      const open = marketPhase().key === 'open'
      timer = setTimeout(() => load(false), partial ? 800 : open ? (intraday ? 5000 : 60000) : 300000)
    }
    load(true)
    return () => { alive = false; clearTimeout(timer) }
  }, [id])
  return state
}

// 1.5초 실시간 시세를 마지막 봉에 바로 반영 (분봉은 새 분이 되면 봉 추가) (다음 차트 조회 전까지 사이를 메움)
function withLivePrice(candles, price, period) {
  if (!candles?.length || !price) return candles
  const last = candles[candles.length - 1]
  if (!String(period).endsWith('m')) {
    // 일봉 이상은 마지막 봉이 오늘(또는 이번 주·달·해)일 때만
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const same = period === 'D' ? last.t === today
      : period === 'Y' ? last.t.slice(0, 4) === today.slice(0, 4)
      : period === 'M' ? last.t.slice(0, 7) === today.slice(0, 7)
      : (new Date(today) - new Date(last.t)) / 86400000 < 7
    if (!same) return candles
  }
  if (String(period).endsWith('m') && /^\d\d:\d\d$/.test(last.t)) {
    const n = parseInt(period, 10) || 1
    const kst = new Date(Date.now() + 9 * 3600000)
    const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes()
    const bucket = Math.floor(mins / n) * n
    const lastMins = parseInt(last.t.slice(0, 2), 10) * 60 + parseInt(last.t.slice(3), 10)
    if (bucket > lastMins && marketPhase().key === 'open') {
      const t = `${String(Math.floor(bucket / 60)).padStart(2, '0')}:${String(bucket % 60).padStart(2, '0')}`
      return [...candles, { t, o: price, h: price, l: price, c: price, v: 0 }]
    }
  }
  if (last.c === price) return candles
  const updated = { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) }
  return [...candles.slice(0, -1), updated]
}

// value: '5m' | 'D' | 'W' | 'M' | 'Y'
function PeriodTabs({ periods, value, onChange }) {
  const isMin = value.endsWith('m')
  const main = isMin ? 'min' : value
  const minute = isMin ? Number(value.slice(0, -1)) : 1
  return (
    <div className="period-tabs-wrap">
      <div className="period-tabs">
        {periods.map((p) => (
          <button key={p.id} className={main === p.id ? 'on' : ''}
            onClick={() => onChange(p.id === 'min' ? `${minute}m` : p.id)}>{p.label}</button>
        ))}
      </div>
      {isMin && (
        <div className="period-tabs sub">
          {MINUTES.map((m) => (
            <button key={m} className={minute === m ? 'on' : ''} onClick={() => onChange(`${m}m`)}>{m}분</button>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, className }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className={className}>{value}</b>
    </div>
  )
}

export default function Stock({ code }) {
  const { prices, stockMap, favorites, toggleFavorite, memos, setMemo, watch, flash } = useMarket()
  const [detail, setDetail] = useState(() => getDetail.peek(code) || null)
  const [failed, setFailed] = useState(false)
  const [period, setPeriodState] = useState(() => loadPeriod('drm.chartPeriod', 'D'))
  const setPeriod = (v) => { setPeriodState(v); savePeriod('drm.chartPeriod', v); track('chart_period') }
  const [view, setView] = useState('chart')
  const [news, setNews] = useState(() => {
    const n = stockMap[code]?.name || prices[code]?.name
    return (n && getNews.peek(code, n)?.news) || []
  })
  const [limits, setLimits] = useState(() => getLimitUps.peek(code) || null)
  const [events, setEvents] = useState(() => getStockEvents.peek(code)?.events || [])
  const [showLimits, setShowLimits] = useState(false)
  const [memo, setMemoText] = useState(memos[code] || '')
  const [saved, setSaved] = useState(false)
  const info = stockMap[code]
  const live = prices[code]
  const name = info?.name || live?.name || code
  const chart = useChart(getStockChart, code, period, 'stock', ['D', 'W', 'M', 'Y', '1m'])
  const intraday = period.endsWith('m')

  useEffect(() => watch(code, true), [code, watch])   // 보고 있는 종목은 1.5초마다
  useEffect(() => {   // 차트가 먼저 뜨게 조금 뒤에 호가를 미리 받아 둠
    const t = setTimeout(() => prefetchOrderbook(code), 1200)
    return () => clearTimeout(t)
  }, [code])
  useEffect(() => {
    let alive = true
    let timer
    setDetail(getDetail.peek(code) || null)
    setFailed(false)
    const load = () =>
      getDetail(code)
        .then((d) => alive && setDetail(d))
        .catch(() => alive && setFailed(true))
        .finally(() => { if (alive) timer = setTimeout(load, marketPhase().key === 'open' ? 10000 : 60000) })
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [code])
  useEffect(() => {
    if (!name || name === code) return
    const last = getNews.peek(code, name)?.news
    if (last) setNews(last)
    getNews(code, name).then((d) => setNews(d.news || [])).catch(() => setNews((n) => n))
  }, [code, name])
  useEffect(() => setMemoText(memos[code] || ''), [code])
  useEffect(() => {
    let alive = true
    setLimits(getLimitUps.peek(code) || null)
    setShowLimits(false)
    getLimitUps(code).then((d) => alive && setLimits(d)).catch(() => alive && setLimits({ up_count: null }))
    setEvents(getStockEvents.peek(code)?.events || [])
    getStockEvents(code).then((d) => alive && setEvents(d.events || [])).catch(() => {})
    return () => { alive = false }
  }, [code])

  if (!/^\d{6}$/.test(code)) {
    return (<><SubBar title="종목" /><main className="page"><Empty title="잘못된 종목 코드입니다" /></main></>)
  }

  // 목록 시세(5초 갱신)가 있으면 우선, 없으면 상세 조회값
  const price = live?.price || detail?.price
  const rate = live?.change_rate ?? detail?.change_rate
  const change = live?.change ?? detail?.change
  const fav = favorites.includes(code)
  const themes = themesOfStock(code)
  const d = detail

  return (
    <>
      <SubBar title="" right={
        <button className={`icon-btn ${fav ? 'fav-on' : ''}`} onClick={() => { if (!fav) track('fav_add'); toggleFavorite(code) }}
          aria-label={fav ? '관심종목 해제' : '관심종목 추가'} aria-pressed={fav}>
          <StarIcon filled={fav} />
        </button>
      } />
      <main className="page">
        <div className="stock-head">
          <span className="stock-meta">{info?.market || ''} {code}{d?.sector ? ` · ${d.sector}` : ''}</span>
          <h1 className="stock-title">{name}</h1>
          {price ? (
            <>
              <b className={`stock-price ${flash[code] ? `flash-${flash[code]}` : ''}`}>{fmtPrice(price)}<small>원</small></b>
              <span className={`stock-change ${tone(rate)}`}>{fmtChange(change)} ({fmtRate(rate)})</span>
            </>
          ) : failed ? <p className="muted">시세를 불러오지 못했습니다</p> : <div className="skeleton price-skel" />}
        </div>

        <div className="segmented">
          <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>차트</button>
          <button className={view === 'book' ? 'on' : ''} onClick={() => { if (view !== 'book') track('orderbook'); setView('book') }}>호가</button>
        </div>
        {view === 'chart' ? (
          <div className="card chart-card">
            {chart.candles === null ? <div className="skeleton chart-skel" /> :
              <Chart candles={withLivePrice(chart.candles, live?.price, period)} resetKey={`${code}:${period}`}
                baseline={intraday ? d?.prev_close : undefined} initialCount={intraday ? 120 : 80} format={fmtPrice} />}
            <PeriodTabs periods={MAIN_PERIODS} value={period} onChange={setPeriod} />
          </div>
        ) : (
          <div className="card">
            <OrderBook code={code} prevClose={d?.prev_close || (price && price - (change || 0))} />
          </div>
        )}

        {d && (
          <div className="card stats">
            <Stat label="시가" value={fmtPrice(d.open)} className={tone(d.open - d.prev_close)} />
            <Stat label="고가" value={fmtPrice(d.high)} className={tone(d.high - d.prev_close)} />
            <Stat label="저가" value={fmtPrice(d.low)} className={tone(d.low - d.prev_close)} />
            <Stat label="전일 종가" value={fmtPrice(d.prev_close)} />
            <Stat label="거래량" value={fmtVolume(live?.volume || d.volume)} />
            <Stat label="거래대금" value={fmtWonShort(live?.trading_value || d.trading_value)} />
            <Stat label="시가총액" value={fmtWonShort(d.market_cap)} />
            <Stat label="외국인 소진율" value={d.foreign_ratio ? `${d.foreign_ratio.toFixed(2)}%` : '-'} />
            <Stat label="52주 최고" value={fmtPrice(d.w52_high)} />
            <Stat label="52주 최저" value={fmtPrice(d.w52_low)} />
            <Stat label="PER" value={d.per ? `${d.per.toFixed(2)}배` : '-'} />
            <Stat label="PBR" value={d.pbr ? `${d.pbr.toFixed(2)}배` : '-'} />
            <Stat label="2년 내 상한가" className={limits?.up_count ? 'up' : ''}
              value={limits === null ? '…' : limits.up_count === null ? '-' : `${limits.up_count}회`} />
            <Stat label="2년 내 하한가" className={limits?.down_count ? 'down' : ''}
              value={limits === null ? '…' : limits.down_count === null ? '-' : `${limits.down_count}회`} />
          </div>
        )}

        {limits?.up_count > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>상한가 기록 <small className="muted">최근 2년</small></h2>
              <button className="more" onClick={() => setShowLimits((v) => !v)}>{showLimits ? '접기' : `${limits.up_count}회 보기`}</button>
            </div>
            {showLimits && (
              <div className="card list">
                {limits.ups.map((u) => (
                  <div key={u.t} className="limit-row">
                    <span>{u.t}</span>
                    <b className="up">{u.rate != null ? `+${u.rate.toFixed(2)}%` : '상한가'}</b>
                    <small>종가 {fmtPrice(u.c)}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {events.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>예정 일정 <small className="muted">90일</small></h2></div>
            <EventRows showName={false} events={events.map((e) => ({ ...e, title: `${e.date.slice(5).replace('-', '/')} ${e.title}` }))} />
          </section>
        )}

        {themes.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>관련 테마</h2></div>
            <div className="chips wrap">
              {themes.map((t) => <button key={t.id} className="chip lg" onClick={() => go(`/theme/${t.id}`)}>{t.name}</button>)}
            </div>
          </section>
        )}

        {news.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>관련 뉴스</h2></div>
            <NewsItems items={news} />
          </section>
        )}

        <section className="section">
          <div className="section-head"><h2>내 메모</h2></div>
          <div className="card memo">
            <textarea value={memo} maxLength={500} placeholder="매수 이유, 목표가 등을 적어 두세요 (이 기기에만 저장)"
              onChange={(e) => { setMemoText(e.target.value); setSaved(false) }} />
            <div className="memo-foot">
              <span>{memo.length}/500</span>
              <button className="btn sm" onClick={() => { setMemo(code, memo.trim()); setSaved(true); track('memo_save') }}>
                {saved ? '저장됨' : '저장'}
              </button>
            </div>
          </div>
        </section>
        <Disclaimer />
      </main>
    </>
  )
}

const INDEX_NAMES = { '0001': '코스피', '1001': '코스닥' }

export function IndexPage({ code }) {
  const { indices } = useMarket()
  // 코스피·코스닥은 한투, 나머지(해외 지수·선물·환율·유가)는 시장종합에서 받은 네이버 지연 시세
  const domestic = !!INDEX_NAMES[code]
  const [overview, setOverview] = useState(() => getMarketOverview.peek())
  useEffect(() => { if (!domestic) getMarketOverview().then(setOverview).catch(() => {}) }, [code])
  const world = domestic ? null : overview?.global?.find((g) => g.code === code)
  const periods = domestic ? INDEX_PERIODS : INDEX_PERIODS.filter((p) => (world?.periods || ['D']).includes(p.id))
  const [period, setPeriodState] = useState(() => loadPeriod('drm.indexPeriod', 'D'))
  const setPeriod = (v) => { setPeriodState(v); savePeriod('drm.indexPeriod', v) }
  const shown = periods.some((p) => p.id === period) ? period : 'D'
  const chart = useChart(domestic ? getIndexChart : getWorldChart, code, shown, domestic ? 'index' : 'world',
    domestic ? ['D', 'W', 'M', 'Y'] : periods.map((p) => p.id))
  const name = INDEX_NAMES[code] || world?.name || '지수'
  const cur = domestic ? indices.find((i) => i.name === name) : world
  return (
    <>
      <SubBar title="" />
      <main className="page">
        <div className="stock-head">
          <span className="stock-meta">{domestic ? '지수' : [world?.date && `${world.date} 기준`, world?.delay && world.delay !== '실시간' && world.delay].filter(Boolean).join(' · ') || '해외'}</span>
          <h1 className="stock-title">{name}</h1>
          {cur ? (
            <>
              <b className="stock-price">{fmtIndex(cur.value)}</b>
              <span className={`stock-change ${tone(cur.changeRate)}`}>
                {cur.change > 0 ? '+' : ''}{cur.change?.toFixed(2)} (<Rate value={cur.changeRate} />)
              </span>
            </>
          ) : <div className="skeleton price-skel" />}
        </div>
        <div className="card chart-card">
          {chart.candles === null ? <div className="skeleton chart-skel" /> :
            <Chart candles={chart.candles} resetKey={`${code}:${shown}`} format={fmtIndex} />}
          {periods.length > 1 && <PeriodTabs periods={periods} value={shown} onChange={setPeriod} />}
        </div>
        <Disclaimer />
      </main>
    </>
  )
}
