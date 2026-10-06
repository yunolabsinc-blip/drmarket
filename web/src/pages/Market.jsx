import { useEffect, useState } from 'react'
import { useMarket } from '../lib/store'
import { getMarketOverview } from '../lib/api'
import { fmtIndex, fmtRate, fmtWonShort, marketPhase, tone } from '../lib/format'
import { go } from '../lib/router'
import { Sparkline } from '../components/Chart'
import MarketNews from '../components/NewsList'
import Calendar from '../components/Calendar'
import { Disclaimer, Section, Skeleton, StatusLine } from '../components/ui'

const TABS = [
  { id: 'overview', label: '종합', path: '/market' },
  { id: 'news', label: '뉴스', path: '/market/news' },
  { id: 'calendar', label: '일정', path: '/market/calendar' },
]

function useOverview(active) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!active) return
    let alive = true
    let timer
    const load = () => {
      const started = Date.now()
      getMarketOverview()
        .then((d) => { if (alive) { setData(d); setFailed(false) } })
        .catch(() => alive && setFailed(true))
        .finally(() => {
          if (!alive) return
          // 요청 시작 기준으로 장중 10초 간격 (응답에 걸린 시간만큼 덜 기다림)
          const every = marketPhase().key === 'open' ? 10000 : 180000
          timer = setTimeout(load, Math.max(1000, every - (Date.now() - started)))
        })
    }
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [active])
  return { data, failed }
}

const signedWon = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtWonShort(Math.abs(n))
const fmtDate = (d) => (d && d.length === 8 ? `${Number(d.slice(4, 6))}월 ${Number(d.slice(6))}일` : '')

function IndexBoard({ global }) {
  const { indices } = useMarket()
  const items = [
    ...indices.map((i) => ({ ...i, code: i.name === '코스피' ? '0001' : '1001', domestic: true })),
    ...(global || []),
  ]
  if (!items.length) return <Skeleton rows={3} />
  return (
    <div className="board-grid">
      {items.map((i) => (
        <button key={i.name} className="board-card" disabled={!i.domestic}
          onClick={() => i.domestic && go(`/index/${i.code}`)}>
          <span className="board-name">{i.name}{i.date && <small>{i.date} 종가</small>}</span>
          <b className="board-value">{fmtIndex(i.value)}</b>
          <span className={`board-change ${tone(i.changeRate)}`}>
            {i.change > 0 ? '+' : ''}{i.change?.toFixed(2)} {fmtRate(i.changeRate)}
          </span>
          {i.spark && <span className="board-spark"><Sparkline values={i.spark} width={56} height={22} /></span>}
        </button>
      ))}
    </div>
  )
}

const INVESTORS = [
  { key: 'individual', label: '개인' },
  { key: 'foreign', label: '외국인' },
  { key: 'institution', label: '기관' },
]

function InvestorFlow({ flow }) {
  if (!flow) return <div className="card muted-box">투자자 동향을 불러오지 못했습니다</div>
  const max = Math.max(1, ...INVESTORS.map((i) => Math.abs(flow[i.key] || 0)))
  return (
    <div className="card flow">
      <div className="flow-date">{fmtDate(flow.date)} 순매수</div>
      {INVESTORS.map((inv) => {
        const v = flow[inv.key] || 0
        const w = (Math.abs(v) / max) * 50
        return (
          <div key={inv.key} className="flow-row">
            <span className="flow-label">{inv.label}</span>
            <span className="flow-track">
              <i className={`flow-bar ${tone(v)}`} style={{ width: `${w}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
            </span>
            <b className={`flow-value ${tone(v)}`}>{signedWon(v)}</b>
          </div>
        )
      })}
      {flow.history?.length > 1 && (
        <table className="flow-table">
          <thead><tr><th>일자</th>{INVESTORS.map((i) => <th key={i.key}>{i.label}</th>)}</tr></thead>
          <tbody>
            {flow.history.map((d) => (
              <tr key={d.date}>
                <td>{d.date.slice(4, 6)}/{d.date.slice(6)}</td>
                {INVESTORS.map((i) => <td key={i.key} className={tone(d[i.key])}>{signedWon(d[i.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// 업종: 등락률 순(막대 = 등락률) / 거래대금 순(막대 = 업종 내 거래대금 비중)
function Sectors({ sectors }) {
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('drm.sectorSort') || 'rate' } catch { return 'rate' } })
  const change = (v) => { setSort(v); try { localStorage.setItem('drm.sectorSort', v) } catch {} }
  if (!sectors?.length) return <div className="card muted-box">업종 정보를 불러오지 못했습니다</div>
  const list = sort === 'value' ? [...sectors].sort((a, b) => b.trading_value - a.trading_value) : sectors
  const max = Math.max(0.5, ...sectors.map((s) => Math.abs(s.change_rate)))
  const totalValue = sectors.reduce((a, s) => a + (s.trading_value || 0), 0) || 1
  const maxValue = Math.max(1, ...sectors.map((s) => s.trading_value || 0))
  return (
    <>
      <div className="sort-toggle" role="tablist">
        <button className={sort === 'rate' ? 'on' : ''} onClick={() => change('rate')}>등락률 순</button>
        <button className={sort === 'value' ? 'on' : ''} onClick={() => change('value')}>거래대금 순</button>
      </div>
      <div className="card sectors">
        {list.map((s) => (
          <div key={s.code} className={`sector-row ${sort === 'value' ? 'by-value' : ''}`}>
            <span className="sector-name">{s.name}</span>
            {sort === 'value' ? (
              <span className="value-track"><i className={`flow-bar ${tone(s.change_rate)}`} style={{ width: `${(s.trading_value / maxValue) * 100}%` }} /></span>
            ) : (
              <span className="flow-track">
                <i className={`flow-bar ${tone(s.change_rate)}`}
                  style={{ width: `${(Math.abs(s.change_rate) / max) * 50}%`, [s.change_rate >= 0 ? 'left' : 'right']: '50%' }} />
              </span>
            )}
            <b className={`sector-rate ${tone(s.change_rate)}`}>
              {sort === 'value' ? <><small>{fmtWonShort(s.trading_value)} · {Math.round((s.trading_value / totalValue) * 100)}%</small>{fmtRate(s.change_rate)}</> : fmtRate(s.change_rate)}
            </b>
          </div>
        ))}
      </div>
      <p className="page-desc" style={{ marginTop: 8 }}>한국거래소 공식 업종 분류입니다. 반도체 종목(삼성전자·SK하이닉스 등)은 전기·전자 업종에 포함됩니다.</p>
    </>
  )
}

function Overview() {
  const { data, failed } = useOverview(true)
  const [mkt, setMkt] = useState('kospi')
  return (
    <>
      <IndexBoard global={data?.global} />
      {/* 코스피/코스닥 선택은 아래 투자자 동향·업종 등락 모두에 적용 */}
      <div className="segmented market-switch">
        <button className={mkt === 'kospi' ? 'on' : ''} onClick={() => setMkt('kospi')}>코스피</button>
        <button className={mkt === 'kosdaq' ? 'on' : ''} onClick={() => setMkt('kosdaq')}>코스닥</button>
      </div>
      <Section title={`투자자별 매매동향 (${mkt === 'kospi' ? '코스피' : '코스닥'})`}>
        {!data && !failed ? <Skeleton rows={3} /> : <InvestorFlow flow={data?.investors?.[mkt]} />}
      </Section>
      <Section title={`업종별 등락 (${mkt === 'kospi' ? '코스피' : '코스닥'})`}>
        {!data && !failed ? <Skeleton rows={6} /> : <Sectors sectors={data?.sectors_by_market?.[mkt] || (mkt === 'kospi' ? data?.sectors : null)} />}
      </Section>
    </>
  )
}

export default function Market({ tab }) {
  const active = TABS.find((t) => t.id === tab) ? tab : 'overview'
  return (
    <main className="page">
      <h1 className="page-title">{active === 'news' ? '뉴스' : active === 'calendar' ? '시장 일정' : '시장종합'}</h1>
      <StatusLine />
      <div className="segmented" role="tablist">
        {TABS.map((t) => (
          <a key={t.id} role="tab" aria-selected={active === t.id} href={`#${t.path}`} className={active === t.id ? 'on' : ''}>{t.label}</a>
        ))}
      </div>
      {active === 'overview' && <Overview />}
      {active === 'news' && <MarketNews />}
      {active === 'calendar' && <Calendar />}
      <Disclaimer />
    </main>
  )
}
