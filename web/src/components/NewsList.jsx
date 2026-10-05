import { useEffect, useState } from 'react'
import { getHeadlines, getMarketNews } from '../lib/api'
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

export function NewsItems({ items }) {
  return (
    <div className="card list">
      {items.map((n, i) => (
        <a key={i} className="news-row" href={n.link} target="_blank" rel="noopener noreferrer">
          <b>{n.title}</b>
          <span>{n.source}{n.source && n.time ? ' · ' : ''}{timeAgo(n.time)}</span>
        </a>
      ))}
    </div>
  )
}

function useNews(fetcher, key, intervalMs = 180000) {
  const [state, setState] = useState({ items: null, failed: false })
  useEffect(() => {
    let alive = true
    let timer
    setState({ items: null, failed: false })
    const load = () =>
      fetcher()
        .then((d) => alive && setState({ items: d.news || [], failed: false }))
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
  const { items, failed } = useNews(() => getMarketNews(topic), topic)
  return (
    <>
      <div className="sort-toggle" role="tablist">
        {TOPICS.map((t) => (
          <button key={t.id} role="tab" aria-selected={topic === t.id} className={topic === t.id ? 'on' : ''} onClick={() => select(t.id)}>{t.label}</button>
        ))}
      </div>
      {items === null ? <Skeleton rows={8} /> : !items.length ? (
        <div className="card muted-box">{failed ? '뉴스를 불러오지 못했습니다' : '최근 1일 뉴스가 없습니다'}</div>
      ) : <NewsItems items={items} />}
      <p className="page-desc" style={{ marginTop: 10 }}>최근 1일 기사 · 제목을 누르면 해당 언론사 페이지로 이동합니다.</p>
    </>
  )
}
