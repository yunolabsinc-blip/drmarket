import { useEffect, useState } from 'react'
import ThemeGrid, { SortToggle } from '../components/ThemeGrid'
import { Headlines } from '../components/NewsList'
import { useMarket } from '../lib/store'
import { getIndexChart } from '../lib/api'
import { fmtIndex, fmtRate, tone } from '../lib/format'
import { go } from '../lib/router'
import { Sparkline } from '../components/Chart'
import { Disclaimer, Section, Skeleton, StatusLine, StockRow } from '../components/ui'
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
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('drm.themeSort') || 'value' } catch { return 'value' } })
  const changeSort = (v) => { setSort(v); try { localStorage.setItem('drm.themeSort', v) } catch {} }
  return (
    <main className="page">
      <StatusLine />
      <IndexCards />
      <Section title="실시간 테마" more={{ href: '#/themes', label: '전체 테마' }}>
        <SortToggle value={sort} onChange={changeSort} />
        <ThemeGrid sort={sort} limit={6} />
      </Section>
      <Section title="거래대금 상위" more={{ href: '#/rank', label: '전체 순위' }}>
        <TopValue />
      </Section>
      <Section title="주요 뉴스" more={{ href: '#/market/news', label: '전체 뉴스' }}>
        <Headlines count={5} />
      </Section>
      <Disclaimer />
    </main>
  )
}
