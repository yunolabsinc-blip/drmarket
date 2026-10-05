import { useEffect, useMemo, useState } from 'react'
import { getHeadlines, getMarketNews } from '../lib/api'
import { useMarket } from '../lib/store'
import { fmtRate, tone } from '../lib/format'
import { go } from '../lib/router'
import { track } from '../lib/analytics'
import { Skeleton } from './ui'

export const TOPICS = [
  { id: 'market', label: '증시' },
  { id: 'feature', label: '특징주' },
  { id: 'global', label: '해외' },
  { id: 'economy', label: '경제' },
]

export function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 60000
  if (diff < 1) return '방금'
  if (diff < 60) return `${Math.floor(diff)}분 전`
  if (diff < 24 * 60) return `${Math.floor(diff / 60)}시간 전`
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 글에서 찾은 종목 버튼 (현재가 등락률 포함). 누르면 종목 화면으로
export function RelatedStocks({ text, onNavigate }) {
  const { findStocks, prices, watch } = useMarket()
  const stocks = useMemo(() => findStocks(text), [findStocks, text])
  useEffect(() => { stocks.forEach((s) => watch(s.code)) }, [stocks, watch])
  if (!stocks.length) return null
  return (
    <div className="related">
      <span className="related-label">관련 종목</span>
      {stocks.map((s) => {
        const p = prices[s.code]
        return (
          <button key={s.code} className="chip stock-chip" onClick={(e) => { e.stopPropagation(); track('stock_chip'); onNavigate?.(); go(`/stock/${s.code}`) }}>
            {s.name}{p && <em className={tone(p.change_rate)}>{fmtRate(p.change_rate)}</em>}
          </button>
        )
      })}
    </div>
  )
}

// 뉴스 한 건: 누르면 요약이 펼쳐지고, "기사 원문 보기"로 언론사 페이지로 이동
export function NewsRow({ item, open, onToggle }) {
  return (
    <div className={`news-item ${open ? 'open' : ''}`}>
      <button className="news-row" onClick={() => { if (!open) track('news_open'); onToggle() }} aria-expanded={open}>
        <b>{item.kind === 'feature' && <span className="tag-feature">특징주</span>}{item.title}</b>
        <span>{item.source}{item.source && item.time ? ' · ' : ''}{timeAgo(item.time)}</span>
      </button>
      {open && (
        <div className="news-body">
          <p>{item.desc || '이 기사는 요약이 제공되지 않습니다. 원문에서 확인해 주세요.'}</p>
          <RelatedStocks text={`${item.title} ${item.desc || ''}`} />
          <a className="btn sm" href={item.link} target="_blank" rel="noopener noreferrer" onClick={() => track('news_link')}>기사 원문 보기 ↗</a>
        </div>
      )}
    </div>
  )
}

export function NewsItems({ items }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="card list">
      {items.map((n, i) => (
        <NewsRow key={n.link || i} item={n} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
      ))}
    </div>
  )
}

function useNews(fetcher, key, intervalMs = 180000) {
  const [state, setState] = useState({ items: null, failed: false, fallback: null })
  useEffect(() => {
    let alive = true
    let timer
    setState({ items: null, failed: false })
    const load = () =>
      fetcher()
        .then((d) => alive && setState({ items: d.news || [], failed: false, fallback: d.fallback || null }))
        .catch(() => alive && setState((s) => ({ items: s.items || [], failed: true })))
        .finally(() => { if (alive) timer = setTimeout(load, intervalMs) })
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [key])
  return state
}

export function Headlines({ count = 5 }) {
  const { items } = useNews(() => getHeadlines(count), 'headlines')
  if (items === null) return <Skeleton rows={3} />
  if (!items.length) return <div className="card muted-box">뉴스를 불러오지 못했습니다</div>
  return <NewsItems items={items} />
}

export default function MarketNews() {
  const [topic, setTopic] = useState(() => { try { return sessionStorage.getItem('drm.newsTopic') || 'market' } catch { return 'market' } })
  const select = (id) => { setTopic(id); try { sessionStorage.setItem('drm.newsTopic', id) } catch {} }
  const { items, failed, fallback } = useNews(() => getMarketNews(topic), topic)
  return (
    <>
      {fallback && <div className="note">지금은 국내 특징주 기사가 없어 증시 뉴스를 보여드립니다. 장이 열리면 특징주 기사가 올라옵니다.</div>}
      <div className="sort-toggle" role="tablist">
        {TOPICS.map((t) => (
          <button key={t.id} role="tab" aria-selected={topic === t.id} className={topic === t.id ? 'on' : ''} onClick={() => select(t.id)}>{t.label}</button>
        ))}
      </div>
      {items === null ? <Skeleton rows={8} /> : !items.length ? (
        <div className="card muted-box">{failed ? '뉴스를 불러오지 못했습니다' : topic === 'feature' ? '최근 3일 안에 국내 특징주 기사가 없습니다. 휴장일 다음 날에는 장이 열린 뒤 올라옵니다.' : '뉴스가 없습니다'}</div>
      ) : <NewsItems items={items} />}
      <p className="page-desc" style={{ marginTop: 10 }}>출처: 연합뉴스·파이낸셜뉴스·매일경제·아시아경제·조선비즈·뉴시스 공개 RSS. 제목을 누르면 요약이, "기사 원문 보기"를 누르면 해당 언론사 페이지가 열립니다.</p>
    </>
  )
}
