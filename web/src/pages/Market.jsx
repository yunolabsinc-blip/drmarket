import { useEffect, useState } from 'react'
import { useMarket } from '../lib/store'
import { getCalendar, getMarketNews, getMarketOverview } from '../lib/api'
import { fmtIndex, fmtRate, fmtWonShort, isMarketOpen, marketPhase, tone } from '../lib/format'
import { go } from '../lib/router'
import { Sparkline } from '../components/Chart'
import MarketNews, { TOPICS } from '../components/NewsList'
import Calendar from '../components/Calendar'
import { Disclaimer, Section, Skeleton, StatusLine } from '../components/ui'
import { ThemeHeadline } from '../components/ThemeGrid'
import { prefetchKeyNews, useKeyNews } from '../lib/themeNews'
import { track } from '../lib/analytics'

const TABS = [
  { id: 'overview', label: '종합', path: '/market' },
  { id: 'news', label: '뉴스', path: '/market/news' },
  { id: 'calendar', label: '일정', path: '/market/calendar' },
]

function useOverview(active) {
  const [data, setData] = useState(() => getMarketOverview.peek() || null)
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
  // 장 열림 표시가 시간 따라 바뀌게 1분마다 다시 그림
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t) }, [])
  const items = [
    ...indices.map((i) => ({ ...i, code: i.name === '코스피' ? '0001' : '1001', domestic: true, market: 'kr' })),
    ...(global || []),
  ]
  // 주요 시장(코스피·코스닥·나스닥·S&P 500)만 늘 보이고 나머지는 펼쳐 보기 (펼침 여부 기억)
  const [more, setMore] = useState(() => { try { return localStorage.getItem('drm.boardMore') === '1' } catch { return false } })
  const toggle = () => { setMore(!more); try { localStorage.setItem('drm.boardMore', more ? '0' : '1') } catch {} }
  if (!items.length) return <Skeleton rows={3} />
  const main = items.filter((i) => i.domestic || MAIN_GLOBAL.includes(i.name))
  const rest = items.filter((i) => !main.includes(i))
  return (
    <>
    <div className="board-grid">
      {(more ? [...main, ...rest] : main).map((i) => {
        // 서버가 장 상태를 알려 주면 그대로(선물·유가는 거의 24시간), 아니면 시간으로 판단
        const open = typeof i.open === 'boolean' ? i.open : isMarketOpen(i.market || 'us')
        return (
        <button key={i.name} className={`board-card ${open ? '' : 'closed'}`} disabled={!i.domestic && !i.periods}
          onClick={() => (i.domestic || i.periods) && go(`/index/${encodeURIComponent(i.code)}`)}>
          <span className="board-name">
            <span className="board-title"><i className={`board-light ${open ? 'on' : 'off'}`} aria-label={open ? '장 열림' : '장 닫힘'} />{i.name}</span>
            {i.date && <small>{i.date} {open ? '' : '종가'}</small>}
          </span>
          <b className="board-value">{fmtIndex(i.value)}</b>
          <span className={`board-change ${tone(i.changeRate)}`}>
            {i.change > 0 ? '+' : ''}{i.change?.toFixed(2)} {fmtRate(i.changeRate)}
          </span>
          {i.spark && <span className="board-spark"><Sparkline values={i.spark} width={56} height={22} /></span>}
        </button>
        )
      })}
    </div>
    {rest.length > 0 && (
      <button className="board-more" onClick={toggle} aria-expanded={more}>
        {more ? '접기 ▴' : `다른 지수 ${rest.length}개 더 보기 ▾`}
      </button>
    )}
    </>
  )
}
const MAIN_GLOBAL = ['나스닥', 'S&P 500']

// 지수 카드 아래 오늘의 시장 기사 (누르면 펼침 → 원문 보기)
const MARKET_NEWS = [
  { id: 'mkt:kospi', label: '코스피' },
  { id: 'mkt:kosdaq', label: '코스닥' },
  { id: 'mkt:us', label: '해외' },
]
function MarketHeadlines() {
  const news = useKeyNews(MARKET_NEWS.map((m) => m.id))
  const list = MARKET_NEWS.filter((m) => news[m.id])
  if (!list.length) return null
  // 같은 기사가 두 곳에 잡히면 한 번만
  const seen = new Set()
  return (
    <div className="market-headlines">
      {list.filter((m) => !seen.has(news[m.id].link) && seen.add(news[m.id].link)).map((m) => (
        <ThemeHeadline key={m.id} item={news[m.id]} label={m.label} large />
      ))}
    </div>
  )
}

const INVESTORS = [
  { key: 'individual', label: '개인' },
  { key: 'foreign', label: '외국인' },
  { key: 'institution', label: '기관' },
]

function FlowHeadline() {
  const news = useKeyNews(['mkt:flow', 'mkt:kospi'])
  const item = news['mkt:flow']
  // 위 코스피 기사와 같으면 겹쳐 보이지 않게 생략
  if (!item || item.link === news['mkt:kospi']?.link) return null
  return <div style={{ marginBottom: 8 }}><ThemeHeadline item={item} label="수급" large /></div>
}

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
// 업종 한 줄: 누르면 아래에 그 업종의 오늘 기사 (없으면 안내)
function SectorItem({ name, open, onToggle, children }) {
  return (
    <div className={`sector-item ${open ? 'open' : ''}`}>
      <button className="sector-btn" onClick={onToggle} aria-expanded={open}>{children}</button>
      {open && <SectorNews name={name} />}
    </div>
  )
}

function SectorNews({ name }) {
  const id = `sector:${name}`
  const news = useKeyNews([id])
  const item = news[id]
  if (item === undefined) return <p className="sector-news-empty">기사 찾는 중…</p>
  return item
    ? <div className="sector-news"><ThemeHeadline item={item} defaultOpen /></div>
    : <p className="sector-news-empty">오늘 이 업종의 주요 기사가 아직 없습니다</p>
}

function Sectors({ sectors }) {
  const [openSector, setOpenSector] = useState(null)
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
          <SectorItem key={s.code} name={s.name} open={openSector === s.code} onToggle={() => { if (openSector !== s.code) track('news_open'); setOpenSector(openSector === s.code ? null : s.code) }}>
          <div className={`sector-row ${sort === 'value' ? 'by-value' : ''}`}>
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
            <span className="sector-caret" aria-hidden="true">{openSector === s.code ? '▴' : '▾'}</span>
          </div>
          </SectorItem>
        ))}
      </div>
      <p className="page-desc" style={{ marginTop: 8 }}>한국거래소 공식 업종 분류입니다. 반도체 종목(삼성전자·SK하이닉스 등)은 전기·전자 업종에 포함됩니다.</p>
    </>
  )
}

function Overview() {
  const { data, failed } = useOverview(true)
  const [mkt, setMkt] = useState('kospi')
  // 업종을 누르자마자 기사가 보이게 지금 시장의 업종 기사를 한 번에 미리 받아 둠
  const sectorKey = (data?.sectors_by_market?.[mkt] || []).map((s) => s.name).join('|')
  useEffect(() => {
    if (!sectorKey) return
    const t = setTimeout(() => prefetchKeyNews(sectorKey.split('|').map((n) => `sector:${n}`)), 1500)
    return () => clearTimeout(t)
  }, [sectorKey])
  return (
    <>
      <IndexBoard global={data?.global} />
      <MarketHeadlines />
      {/* 코스피/코스닥 선택은 아래 투자자 동향·업종 등락 모두에 적용 */}
      <div className="segmented market-switch">
        <button className={mkt === 'kospi' ? 'on' : ''} onClick={() => setMkt('kospi')}>코스피</button>
        <button className={mkt === 'kosdaq' ? 'on' : ''} onClick={() => setMkt('kosdaq')}>코스닥</button>
      </div>
      <Section title={`투자자별 매매동향 (${mkt === 'kospi' ? '코스피' : '코스닥'})`}>
        <FlowHeadline />
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
  // 뉴스·일정 탭도 누르자마자 보이게 미리 받아 둠 (지난 결과가 있으면 그것부터 보여 줌)
  useEffect(() => {
    const t = setTimeout(() => {
      if (active !== 'news') getMarketNews(TOPICS[0].id).catch(() => {})
      if (active !== 'calendar') getCalendar().catch(() => {})
    }, 1000)
    return () => clearTimeout(t)
  }, [])
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
