import { useEffect, useState } from 'react'
import { themesOfStock, useMarket } from '../lib/store'
import { getDetail, getIndexChart, getLimitUps, getNews, getStockChart, getStockEvents } from '../lib/api'
import { fmtChange, fmtIndex, fmtPrice, fmtRate, fmtVolume, fmtWonShort, marketPhase, tone } from '../lib/format'
import { go } from '../lib/router'
import Chart from '../components/Chart'
import OrderBook from '../components/OrderBook'
import { Disclaimer, Empty, Rate, StarIcon, SubBar } from '../components/ui'
import { NewsItems } from '../components/NewsList'
import { EventRows } from '../components/Calendar'

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

function useChart(fetcher, key, period) {
  const [state, setState] = useState({ candles: null, error: false })
  useEffect(() => {
    let alive = true
    setState({ candles: null, error: false })
    fetcher(key, period)
      .then((d) => alive && setState({ candles: d.candles || [], error: false }))
      .catch(() => alive && setState({ candles: [], error: true }))
    return () => { alive = false }
  }, [key, period])
  return state
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
  const [detail, setDetail] = useState(null)
  const [failed, setFailed] = useState(false)
  const [period, setPeriodState] = useState(() => loadPeriod('drm.chartPeriod', 'D'))
  const setPeriod = (v) => { setPeriodState(v); savePeriod('drm.chartPeriod', v) }
  const [view, setView] = useState('chart')
  const [news, setNews] = useState([])
  const [limits, setLimits] = useState(null)
  const [events, setEvents] = useState([])
  const [showLimits, setShowLimits] = useState(false)
  const [memo, setMemoText] = useState(memos[code] || '')
  const [saved, setSaved] = useState(false)
  const info = stockMap[code]
  const live = prices[code]
  const name = info?.name || live?.name || code
  const chart = useChart(getStockChart, code, period)
  const intraday = period.endsWith('m')

  useEffect(() => { watch(code) }, [code, watch])
  useEffect(() => {
    let alive = true
    let timer
    setDetail(null)
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
    getNews(code, name).then((d) => setNews(d.news || [])).catch(() => setNews([]))
  }, [code, name])
  useEffect(() => setMemoText(memos[code] || ''), [code])
  useEffect(() => {
    let alive = true
    setLimits(null)
    setShowLimits(false)
    getLimitUps(code).then((d) => alive && setLimits(d)).catch(() => alive && setLimits({ up_count: null }))
    setEvents([])
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
        <button className={`icon-btn ${fav ? 'fav-on' : ''}`} onClick={() => toggleFavorite(code)}
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
          <button className={view === 'book' ? 'on' : ''} onClick={() => setView('book')}>호가</button>
        </div>
        {view === 'chart' ? (
          <div className="card chart-card">
            {chart.candles === null ? <div className="skeleton chart-skel" /> :
              <Chart candles={chart.candles} baseline={intraday ? d?.prev_close : undefined}
                initialCount={intraday ? 120 : 80} format={fmtPrice} />}
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
              <button className="btn sm" onClick={() => { setMemo(code, memo.trim()); setSaved(true) }}>
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
  const [period, setPeriodState] = useState(() => loadPeriod('drm.indexPeriod', 'D'))
  const setPeriod = (v) => { setPeriodState(v); savePeriod('drm.indexPeriod', v) }
  const chart = useChart(getIndexChart, code, period)
  const name = INDEX_NAMES[code] || '지수'
  const cur = indices.find((i) => i.name === name)
  return (
    <>
      <SubBar title="" />
      <main className="page">
        <div className="stock-head">
          <span className="stock-meta">지수</span>
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
            <Chart candles={chart.candles} format={fmtIndex} />}
          <PeriodTabs periods={INDEX_PERIODS} value={period} onChange={setPeriod} />
        </div>
        <Disclaimer />
      </main>
    </>
  )
}
