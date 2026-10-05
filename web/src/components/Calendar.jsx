import { useEffect, useMemo, useState } from 'react'
import { getCalendar } from '../lib/api'
import { go } from '../lib/router'
import { Skeleton } from './ui'
import { track } from '../lib/analytics'

export const EVENT_TYPES = {
  holiday: { label: '휴장', cls: 'ev-holiday', dot: '#f04452' },
  ipo: { label: '공모청약', cls: 'ev-ipo', dot: '#4b3bf5' },
  listing: { label: '신규상장', cls: 'ev-listing', dot: '#059669' },
  dividend: { label: '배당', cls: 'ev-dividend', dot: '#b45309' },
  bonus: { label: '무상증자', cls: 'ev-bonus', dot: '#059669' },
  meeting: { label: '주총', cls: 'ev-meeting', dot: '#3182f6' },
  capdec: { label: '감자', cls: 'ev-capdec', dot: '#7c3aed' },
  merger: { label: '합병·분할', cls: 'ev-merger', dot: '#7c3aed' },
}
const SCOPES = [
  { id: 'all', label: '전체' },
  { id: 'market', label: '시장' },
  { id: 'stock', label: '종목' },
]
const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmtDay = (s) => {
  const d = new Date(s + 'T00:00:00')
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`
}

export function EventRows({ events, showName = true }) {
  return (
    <div className="card list">
      {events.map((e, i) => {
        const t = EVENT_TYPES[e.type] || { label: e.type, cls: '' }
        const clickable = showName && e.code && /^\d{6}$/.test(e.code)
        const Row = clickable ? 'button' : 'div'
        return (
          <Row key={i} className="cal-row" onClick={clickable ? () => go(`/stock/${e.code}`) : undefined}>
            <span className={`ev-type ${t.cls}`}>{t.label}</span>
            <span className="cal-main">
              <b>{e.title}</b>
              {e.detail && <small>{e.detail}</small>}
            </span>
          </Row>
        )
      })}
    </div>
  )
}

// 달력(월) 보기: 날짜별 점 표시, 누르면 그날 일정
function MonthGrid({ events, today, selected, onSelect }) {
  const [cursor, setCursor] = useState(() => new Date(today.slice(0, 7) + '-01T00:00:00'))
  const byDate = useMemo(() => {
    const m = {}
    for (const e of events) (m[e.date] ||= []).push(e)
    return m
  }, [events])
  const y = cursor.getFullYear(), mo = cursor.getMonth()
  const first = new Date(y, mo, 1)
  const cells = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null)
  for (let d = 1; d <= new Date(y, mo + 1, 0).getDate(); d++) cells.push(new Date(y, mo, d))
  const move = (n) => setCursor(new Date(y, mo + n, 1))
  return (
    <div className="card month">
      <div className="month-head">
        <button className="icon-btn" onClick={() => move(-1)} aria-label="이전 달">‹</button>
        <b>{y}년 {mo + 1}월</b>
        <button className="icon-btn" onClick={() => move(1)} aria-label="다음 달">›</button>
      </div>
      <div className="month-grid">
        {DAYS.map((d, i) => <span key={d} className={`dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />
          const k = iso(d)
          const list = byDate[k] || []
          const dots = [...new Set(list.map((e) => EVENT_TYPES[e.type]?.dot || '#999'))].slice(0, 3)
          const cls = ['day', k === today ? 'today' : '', k === selected ? 'sel' : '', d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '', list.some((e) => e.type === 'holiday') ? 'closed' : ''].join(' ')
          return (
            <button key={k} className={cls} onClick={() => onSelect(k === selected ? null : k)} aria-label={`${k} 일정 ${list.length}건`}>
              <span>{d.getDate()}</span>
              <i className="dots">{dots.map((c) => <b key={c} style={{ background: c }} />)}</i>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Calendar() {
  const [events, setEvents] = useState(null)
  const [filter, setFilter] = useState('all')
  const [scope, setScope] = useState('all')
  const [view, setView] = useState(() => { try { return localStorage.getItem('drm.calView') || 'list' } catch { return 'list' } })
  const [selected, setSelected] = useState(null)
  const changeView = (v) => { setView(v); if (v === 'month') track('calendar_month'); try { localStorage.setItem('drm.calView', v) } catch {} }

  useEffect(() => {
    let alive = true
    getCalendar().then((d) => alive && setEvents(d.events || [])).catch(() => alive && setEvents([]))
    return () => { alive = false }
  }, [])

  const today = iso(new Date())
  const scoped = useMemo(() => (events || []).filter((e) => scope === 'all' || e.scope === scope), [events, scope])
  const list = useMemo(() => (filter === 'all' ? scoped : scoped.filter((e) => e.type === filter)), [scoped, filter])
  const groups = useMemo(() => {
    const map = new Map()
    for (const e of list) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date).push(e)
    }
    return [...map.entries()]
  }, [list])
  const counts = useMemo(() => {
    const c = {}
    for (const e of scoped) c[e.type] = (c[e.type] || 0) + 1
    return c
  }, [scoped])

  if (events === null) return <Skeleton rows={6} />
  const dayEvents = selected ? list.filter((e) => e.date === selected) : []
  return (
    <>
      <div className="cal-tools">
        <div className="segmented small" role="tablist">
          {SCOPES.map((s) => (
            <button key={s.id} role="tab" aria-selected={scope === s.id} className={scope === s.id ? 'on' : ''}
              onClick={() => { setScope(s.id); setFilter('all') }}>{s.label}</button>
          ))}
        </div>
        <button className="view-toggle" onClick={() => changeView(view === 'list' ? 'month' : 'list')}>
          {view === 'list' ? '달력 보기' : '목록 보기'}
        </button>
      </div>
      <div className="chips wrap" style={{ marginBottom: 12 }}>
        <button className={`chip ${filter === 'all' ? 'chip-on' : ''}`} onClick={() => setFilter('all')}>전체 {scoped.length}</button>
        {Object.entries(EVENT_TYPES).filter(([k]) => counts[k]).map(([k, t]) => (
          <button key={k} className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>{t.label} {counts[k]}</button>
        ))}
      </div>
      {view === 'month' ? (
        <>
          <MonthGrid events={list} today={today} selected={selected} onSelect={setSelected} />
          {selected && (
            <section className="cal-day today" style={{ marginTop: 14 }}>
              <h3>{fmtDay(selected)}{selected === today && <span className="cal-today">오늘</span>}</h3>
              {dayEvents.length ? <EventRows events={dayEvents} /> : <div className="card muted-box">이 날은 등록된 일정이 없습니다</div>}
            </section>
          )}
          {!selected && <p className="page-desc" style={{ marginTop: 10 }}>날짜를 누르면 그날의 일정이 나옵니다. 점 색은 일정 종류입니다.</p>}
        </>
      ) : !groups.length ? <div className="card muted-box">앞으로 60일 안에 등록된 일정이 없습니다</div> : groups.map(([date, evs]) => (
        <section key={date} className={`cal-day ${date === today ? 'today' : ''}`}>
          <h3>{fmtDay(date)}{date === today && <span className="cal-today">오늘</span>}</h3>
          <EventRows events={evs} />
        </section>
      ))}
      <p className="page-desc" style={{ marginTop: 10 }}>출처: 한국예탁결제원·한국거래소 (한국투자증권 Open API). 시장 = 휴장·공모주 청약·신규 상장, 종목 = 배당·주총·무상증자·감자·합병. 실적 발표 등 기업 자체 일정은 포함되지 않습니다.</p>
    </>
  )
}
