import { useEffect, useState } from 'react'
import { useMarket } from '../lib/store'
import { getIndexChart } from '../lib/api'
import { fmtIndex, fmtRate, tone } from '../lib/format'
import { go } from '../lib/router'
import { Sparkline } from '../components/Chart'
import { Disclaimer, Rate, RatePill, Section, Skeleton, StatusLine, StockRow } from '../components/ui'
import { useRanking } from './Rank'

const INDEX_CODES = { 코스피: '0001', 코스닥: '1001' }

function IndexCards() {
  const { indices } = useMarket()
  const [spark, setSpark] = useState({})
  useEffect(() => {
    Object.entries(INDEX_CODES).forEach(([name, code]) =>
      getIndexChart(code, 'D')
        .then((d) => setSpark((s) => ({ ...s, [name]: d.candles.slice(-30).map((c) => c.c) })))
        .catch(() => {}),
    )
  }, [])
  if (!indices.length) return <div className="index-grid"><div className="index-card skeleton" /><div className="index-card skeleton" /></div>
  return (
    <div className="index-grid">
      {indices.map((i) => (
        <button key={i.name} className="index-card" onClick={() => go(`/index/${INDEX_CODES[i.name]}`)}>
          <span className="index-name">{i.name}</span>
          <b className="index-value">{fmtIndex(i.value)}</b>
          <span className={`index-change ${tone(i.changeRate)}`}>
            {i.change > 0 ? '+' : ''}{i.change?.toFixed(2)} {fmtRate(i.changeRate)}
          </span>
          <span className="index-spark"><Sparkline values={spark[i.name]} width={64} height={26} /></span>
        </button>
      ))}
    </div>
  )
}

function TopThemes() {
  const { themes } = useMarket()
  const ready = themes.some((t) => t.avg !== null)
  if (!ready) return <Skeleton rows={5} />
  return (
    <div className="card list">
      {themes.slice(0, 5).map((t, i) => (
        <button key={t.id} className="theme-row" onClick={() => go(`/theme/${t.id}`)}>
          <span className="rank-no">{i + 1}</span>
          <span className="theme-main">
            <b>{t.name}</b>
            {t.leader && <span className="theme-sub">{t.leader.name} <Rate value={t.leader.change_rate} /></span>}
          </span>
          <RatePill value={t.avg} />
        </button>
      ))}
    </div>
  )
}

function TopValue() {
  const { rows, loading } = useRanking('amount')
  if (loading && !rows.length) return <Skeleton rows={5} />
  if (!rows.length) return <div className="card muted-box">순위 정보를 불러오지 못했습니다</div>
  return (
    <div className="card list">
      {rows.slice(0, 5).map((s, i) => <StockRow key={s.code} stock={s} rank={i + 1} />)}
    </div>
  )
}

export default function Home() {
  return (
    <main className="page">
      <StatusLine />
      <IndexCards />
      <Section title="오늘 강한 테마" more={{ href: '#/themes', label: '전체 테마' }}>
        <TopThemes />
      </Section>
      <Section title="거래대금 상위" more={{ href: '#/rank', label: '전체 순위' }}>
        <TopValue />
      </Section>
      <Disclaimer />
    </main>
  )
}
