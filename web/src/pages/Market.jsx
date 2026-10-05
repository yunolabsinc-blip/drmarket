import { useEffect, useState } from 'react'
import { useMarket } from '../lib/store'
import { getMarketOverview } from '../lib/api'
import { fmtIndex, fmtRate, fmtWonShort, marketPhase, tone } from '../lib/format'
import { go } from '../lib/router'
import { Sparkline } from '../components/Chart'
import { Disclaimer, Section, Skeleton, StatusLine } from '../components/ui'

function useOverview() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let timer
    const load = () =>
      getMarketOverview()
        .then((d) => { if (alive) { setData(d); setFailed(false) } })
        .catch(() => alive && setFailed(true))
        .finally(() => { if (alive) timer = setTimeout(load, marketPhase().key === 'open' ? 30000 : 180000) })
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [])
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

function Sectors({ sectors }) {
  if (!sectors?.length) return <div className="card muted-box">업종 정보를 불러오지 못했습니다</div>
  const max = Math.max(0.5, ...sectors.map((s) => Math.abs(s.change_rate)))
  return (
    <div className="card sectors">
      {sectors.map((s) => (
        <div key={s.code} className="sector-row">
          <span className="sector-name">{s.name}</span>
          <span className="flow-track">
            <i className={`flow-bar ${tone(s.change_rate)}`}
              style={{ width: `${(Math.abs(s.change_rate) / max) * 50}%`, [s.change_rate >= 0 ? 'left' : 'right']: '50%' }} />
          </span>
          <b className={`sector-rate ${tone(s.change_rate)}`}>{fmtRate(s.change_rate)}</b>
        </div>
      ))}
    </div>
  )
}

export default function Market() {
  const { data, failed } = useOverview()
  const [mkt, setMkt] = useState('kospi')
  return (
    <main className="page">
      <h1 className="page-title">시장종합</h1>
      <StatusLine />
      <IndexBoard global={data?.global} />
      <Section title="투자자별 매매동향">
        <div className="segmented">
          <button className={mkt === 'kospi' ? 'on' : ''} onClick={() => setMkt('kospi')}>코스피</button>
          <button className={mkt === 'kosdaq' ? 'on' : ''} onClick={() => setMkt('kosdaq')}>코스닥</button>
        </div>
        {!data && !failed ? <Skeleton rows={3} /> : <InvestorFlow flow={data?.investors?.[mkt]} />}
      </Section>
      <Section title="업종별 등락 (코스피)">
        {!data && !failed ? <Skeleton rows={6} /> : <Sectors sectors={data?.sectors} />}
      </Section>
      <Disclaimer />
    </main>
  )
}
