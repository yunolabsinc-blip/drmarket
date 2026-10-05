import { useEffect, useMemo, useState } from 'react'
import { getCalendar } from '../lib/api'
import { go } from '../lib/router'
import { Skeleton } from './ui'

const TYPES = {
  holiday: { label: '휴장', cls: 'ev-holiday' },
  ipo: { label: '공모청약', cls: 'ev-ipo' },
  listing: { label: '신규상장', cls: 'ev-listing' },
  dividend: { label: '배당', cls: 'ev-dividend' },
  bonus: { label: '무상증자', cls: 'ev-bonus' },
  meeting: { label: '주총', cls: 'ev-meeting' },
  capdec: { label: '감자', cls: 'ev-capdec' },
  merger: { label: '합병·분할', cls: 'ev-merger' },
}
const DAYS = ['일', '월', '화', '수', '목', '금', '토']

const fmtDay = (iso) => {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`
}

export default function Calendar() {
  const [events, setEvents] = useState(null)
  const [filter, setFilter] = useState('all')
  useEffect(() => {
    let alive = true
    getCalendar().then((d) => alive && setEvents(d.events || [])).catch(() => alive && setEvents([]))
    return () => { alive = false }
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const groups = useMemo(() => {
    if (!events) return []
    const list = filter === 'all' ? events : events.filter((e) => e.type === filter)
    const map = new Map()
    for (const e of list) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date).push(e)
    }
    return [...map.entries()]
  }, [events, filter])
  const counts = useMemo(() => {
    const c = {}
    for (const e of events || []) c[e.type] = (c[e.type] || 0) + 1
    return c
  }, [events])

  if (events === null) return <Skeleton rows={6} />
  return (
    <>
      <div className="chips wrap" style={{ marginBottom: 12 }}>
        <button className={`chip ${filter === 'all' ? 'chip-on' : ''}`} onClick={() => setFilter('all')}>전체 {events.length}</button>
        {Object.entries(TYPES).filter(([k]) => counts[k]).map(([k, t]) => (
          <button key={k} className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>{t.label} {counts[k]}</button>
        ))}
      </div>
      {!groups.length ? <div className="card muted-box">앞으로 60일 안에 등록된 일정이 없습니다</div> : groups.map(([date, list]) => (
        <section key={date} className={`cal-day ${date === today ? 'today' : ''}`}>
          <h3>{fmtDay(date)}{date === today && <span className="cal-today">오늘</span>}</h3>
          <div className="card list">
            {list.map((e, i) => {
              const t = TYPES[e.type] || { label: e.type, cls: '' }
              const Row = e.code && /^\d{6}$/.test(e.code) ? 'button' : 'div'
              return (
                <Row key={i} className="cal-row" onClick={Row === 'button' ? () => go(`/stock/${e.code}`) : undefined}>
                  <span className={`ev-type ${t.cls}`}>{t.label}</span>
                  <span className="cal-main">
                    <b>{e.title}</b>
                    {e.detail && <small>{e.detail}</small>}
                  </span>
                </Row>
              )
            })}
          </div>
        </section>
      ))}
      <p className="page-desc" style={{ marginTop: 10 }}>출처: 한국예탁결제원·한국거래소 (한국투자증권 Open API). 공모주 청약은 청약 직전에 등록되며, 실적 발표 등 기업 자체 일정은 포함되지 않습니다.</p>
    </>
  )
}
