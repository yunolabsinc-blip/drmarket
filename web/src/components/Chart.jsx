import { useEffect, useMemo, useRef, useState } from 'react'

// 캔들 차트 (MTS 방식): 거래량 · 이동평균선(5/20/60) · 오른쪽 가격축 · 드래그 이동 · 휠/핀치/버튼 확대 · 십자선
// candles: [{t, o, h, l, c, v}] 오래된 → 최신
const MAS = [
  { n: 5, color: '#f59e0b' },
  { n: 20, color: '#10b981' },
  { n: 60, color: '#8b5cf6' },
]
const PAD = { top: 10, right: 58, bottom: 20, left: 6 }
const VOL_H = 46

const fmtNum = (v) => (v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}만` : v.toLocaleString())

export default function Chart({ candles, baseline, height = 300, format = (v) => v.toLocaleString(), initialCount = 80 }) {
  const wrap = useRef(null)
  const [width, setWidth] = useState(340)
  const [view, setView] = useState({ count: initialCount, end: candles?.length || 0 })
  const [cross, setCross] = useState(null)      // 십자선 위치 (전체 배열 인덱스)
  const gesture = useRef(null)
  const live = useRef({})                        // 터치 핸들러에서 최신 값을 읽기 위한 참조
  const len = candles?.length || 0

  const idxAt = (clientX) => {
    const { start, end, step } = live.current
    const rect = wrap.current.getBoundingClientRect()
    const i = start + Math.floor((clientX - rect.left - PAD.left) / step)
    return Math.max(start, Math.min(end - 1, i))
  }
  const clampCount = (n) => Math.round(Math.max(10, Math.min(live.current.len, n)))
  const clampEnd = (e) => Math.max(Math.min(live.current.count, live.current.len), Math.min(live.current.len, e))

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let g = null
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onStart = (e) => {
      if (e.touches.length === 2) {
        g = { mode: 'pinch', dist0: dist(e.touches), count0: live.current.count, end0: live.current.end }
        e.preventDefault()
      } else if (e.touches.length === 1) {
        const t = e.touches[0]
        g = { mode: null, x0: t.clientX, y0: t.clientY, lastY: t.clientY, end0: live.current.end }
      }
    }
    const onMove = (e) => {
      if (!g) return
      if (e.touches.length === 2 && g.mode !== 'scroll') {
        if (g.mode !== 'pinch') g = { mode: 'pinch', dist0: dist(e.touches), count0: live.current.count, end0: live.current.end }
        e.preventDefault()
        const ratio = dist(e.touches) / g.dist0
        const count = clampCount(g.count0 / ratio)
        const nextEnd = clampEnd(g.end0)
        setView({ count, end: nextEnd })
        setCross(null)
        return
      }
      const t = e.touches[0]
      if (!g.mode) {
        const dx = t.clientX - g.x0, dy = t.clientY - g.y0
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return
        g.mode = Math.abs(dx) > Math.abs(dy) ? 'pan' : 'scroll'
        if (g.mode === 'pan') setCross(null)
      }
      if (g.mode === 'pan') {
        e.preventDefault()
        const nextEnd = clampEnd(g.end0 - Math.round((t.clientX - g.x0) / live.current.step))
        setView((v) => ({ ...v, end: nextEnd }))
      } else if (g.mode === 'scroll') {
        // touch-action: none 이라 세로 스크롤은 직접 넘긴다
        window.scrollBy(0, g.lastY - t.clientY)
        g.lastY = t.clientY
      }
    }
    const onEnd = (e) => {
      if (!g) return
      if (!g.mode && e.changedTouches.length === 1) {
        const i = idxAt(e.changedTouches[0].clientX)
        setCross((c) => (c === i ? null : i))
      }
      if (e.touches.length === 0) g = null
      else if (g.mode === 'pinch') g = { mode: 'scroll' }   // 핀치 후 남은 손가락은 무시
    }
    const onWheel = (e) => {
      e.preventDefault()
      setView((v) => ({ ...v, count: clampCount(live.current.count * (e.deltaY > 0 ? 1.2 : 1 / 1.2)) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [len > 0])

  // 데이터가 바뀌면 최신 구간으로
  useEffect(() => {
    setView({ count: Math.min(initialCount, len) || len, end: len })
    setCross(null)
  }, [candles, initialCount, len])

  // 이동평균 (전체 데이터 기준으로 계산해야 화면 왼쪽 끝도 정확)
  const mas = useMemo(() => {
    if (!len) return []
    return MAS.map(({ n, color }) => {
      const arr = new Array(len).fill(null)
      let sum = 0
      for (let i = 0; i < len; i++) {
        sum += candles[i].c
        if (i >= n) sum -= candles[i - n].c
        if (i >= n - 1) arr[i] = sum / n
      }
      return { n, color, arr }
    })
  }, [candles, len])

  const count = Math.max(10, Math.min(view.count, len))
  const end = Math.max(count, Math.min(view.end, len))
  const start = end - count
  const visible = candles ? candles.slice(start, end) : []

  const geo = useMemo(() => {
    if (!visible.length) return null
    let min = Infinity, max = -Infinity
    for (const d of visible) { if (d.l < min) min = d.l; if (d.h > max) max = d.h }
    for (const m of mas) for (let i = start; i < end; i++) { const v = m.arr[i]; if (v != null) { if (v < min) min = v; if (v > max) max = v } }
    if (baseline && baseline > 0) { min = Math.min(min, baseline); max = Math.max(max, baseline) }
    if (min === max) { min *= 0.995; max *= 1.005 }
    const span = max - min
    min -= span * 0.04; max += span * 0.04
    const priceH = height - PAD.top - PAD.bottom - VOL_H - 6
    const w = width - PAD.left - PAD.right
    const step = w / count
    const volMax = Math.max(1, ...visible.map((d) => d.v))
    return {
      min, max, step, priceH, w,
      x: (i) => PAD.left + step * (i - start) + step / 2,
      y: (v) => PAD.top + ((max - v) / (max - min)) * priceH,
      volTop: PAD.top + priceH + 6,
      vy: (v) => PAD.top + priceH + 6 + VOL_H - (v / volMax) * VOL_H,
    }
  }, [visible, mas, start, end, count, baseline, width, height])

  live.current = { len, count, end, start, step: geo?.step || 1 }
  if (!len || !geo) {
    return <div ref={wrap} className="chart-empty" style={{ height }}>차트 데이터가 없습니다</div>
  }
  const { x, y, vy, step, min, max, priceH, volTop } = geo

  // ── 제스처 ──

  // 마우스: 이동하면 십자선, 드래그하면 이동
  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse') return
    gesture.current = { startX: e.clientX, end0: end, moved: false }
  }
  const onPointerMove = (e) => {
    if (e.pointerType !== 'mouse') return
    const g = gesture.current
    if (!g) { setCross(idxAt(e.clientX)); return }
    const dx = e.clientX - g.startX
    if (!g.moved && Math.abs(dx) < 6) return
    g.moved = true
    setCross(null)
    const nextEnd = clampEnd(g.end0 - Math.round(dx / live.current.step))
    setView((v) => ({ ...v, end: nextEnd }))
  }
  const onPointerUp = (e) => {
    if (e.pointerType !== 'mouse') return
    gesture.current = null
  }
  const zoom = (factor) => setView((v) => ({ ...v, count: clampCount(count * factor) }))

  // ── 눈금 ──
  const ticks = [0, 1, 2, 3, 4].map((i) => min + ((max - min) * i) / 4)
  const dateIdx = [0, 0.33, 0.66, 1].map((r) => start + Math.min(count - 1, Math.round((count - 1) * r)))
  let hiIdx = start, loIdx = start
  for (let i = start; i < end; i++) { if (candles[i].h > candles[hiIdx].h) hiIdx = i; if (candles[i].l < candles[loIdx].l) loIdx = i }
  const last = candles[len - 1]
  const c = cross != null ? candles[cross] : null
  const prevC = cross != null && cross > 0 ? candles[cross - 1].c : baseline || null
  const bw = Math.max(1, step * 0.62)
  const maPath = (m) => {
    let d = ''
    for (let i = start; i < end; i++) {
      const v = m.arr[i]
      if (v == null) continue
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    }
    return d
  }

  return (
    <div ref={wrap} className="chart" style={{ height }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') { gesture.current = null; setCross(null) } }}>
      <svg width={width} height={height}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={width - PAD.right + 6} y={y(t) + 4} className="chart-axis">{format(t)}</text>
          </g>
        ))}
        {baseline > 0 && baseline > min && baseline < max && (
          <line x1={PAD.left} x2={width - PAD.right} y1={y(baseline)} y2={y(baseline)} stroke="var(--text-3)" strokeDasharray="3 4" />
        )}
        {visible.map((d, k) => {
          const i = start + k
          const up = d.c >= d.o
          const col = up ? 'var(--up)' : 'var(--down)'
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={y(d.h)} y2={y(d.l)} stroke={col} strokeWidth="1" />
              <rect x={x(i) - bw / 2} width={bw} y={y(Math.max(d.o, d.c))} height={Math.max(1, Math.abs(y(d.o) - y(d.c)))} fill={col} />
              <rect x={x(i) - bw / 2} width={bw} y={vy(d.v)} height={Math.max(0, volTop + VOL_H - vy(d.v))} fill={col} opacity="0.45" />
            </g>
          )
        })}
        {mas.map((m) => <path key={m.n} d={maPath(m)} fill="none" stroke={m.color} strokeWidth="1.2" opacity="0.9" />)}
        <line x1={PAD.left} x2={width - PAD.right} y1={volTop} y2={volTop} stroke="var(--line)" />
        {!c && (
          <>
            <text x={x(hiIdx)} y={Math.max(PAD.top + 10, y(candles[hiIdx].h) - 5)} textAnchor={x(hiIdx) > width / 2 ? 'end' : 'start'} className="chart-label">고 {format(candles[hiIdx].h)}</text>
            <text x={x(loIdx)} y={y(candles[loIdx].l) + 12} textAnchor={x(loIdx) > width / 2 ? 'end' : 'start'} className="chart-label">저 {format(candles[loIdx].l)}</text>
          </>
        )}
        {dateIdx.map((i, k) => (
          <text key={k} x={x(i)} y={height - 5} textAnchor={k === 0 ? 'start' : k === 3 ? 'end' : 'middle'} className="chart-axis">
            {candles[i].t.length > 8 ? candles[i].t.slice(2) : candles[i].t}
          </text>
        ))}
        {c && (
          <>
            <line x1={x(cross)} x2={x(cross)} y1={PAD.top} y2={volTop + VOL_H} stroke="var(--text-2)" strokeDasharray="2 3" />
            <line x1={PAD.left} x2={width - PAD.right} y1={y(c.c)} y2={y(c.c)} stroke="var(--text-2)" strokeDasharray="2 3" />
            <rect x={width - PAD.right + 2} y={y(c.c) - 9} width={PAD.right - 4} height={18} rx="4" fill="var(--text)" />
            <text x={width - PAD.right + 6} y={y(c.c) + 4} className="chart-axis" fill="#fff">{format(c.c)}</text>
          </>
        )}
        {/* 현재가 표시 (최신 봉이 보일 때) */}
        {end === len && !c && (
          <>
            <rect x={width - PAD.right + 2} y={y(last.c) - 9} width={PAD.right - 4} height={18} rx="4" fill={last.c >= last.o ? 'var(--up)' : 'var(--down)'} />
            <text x={width - PAD.right + 6} y={y(last.c) + 4} className="chart-axis" fill="#fff">{format(last.c)}</text>
          </>
        )}
      </svg>
      <div className="chart-legend">
        {mas.map((m) => <span key={m.n}><i style={{ background: m.color }} />{m.n}</span>)}
      </div>
      {c && (
        <div className="chart-info">
          <b>{c.t}</b>
          <span>시 <em className={c.o >= (prevC || c.o) ? 'up' : 'down'}>{format(c.o)}</em></span>
          <span>고 <em className="up">{format(c.h)}</em></span>
          <span>저 <em className="down">{format(c.l)}</em></span>
          <span>종 <em className={prevC ? (c.c > prevC ? 'up' : c.c < prevC ? 'down' : '') : ''}>{format(c.c)}</em>
            {prevC ? <small className={c.c > prevC ? 'up' : c.c < prevC ? 'down' : ''}> {c.c > prevC ? '+' : ''}{(((c.c - prevC) / prevC) * 100).toFixed(2)}%</small> : null}</span>
          <span>량 <em>{fmtNum(c.v)}</em></span>
        </div>
      )}
      <div className="chart-zoom">
        <button onClick={() => zoom(1.4)} aria-label="축소">−</button>
        <button onClick={() => zoom(1 / 1.4)} aria-label="확대">+</button>
        {end < len && <button onClick={() => setView((v) => ({ ...v, end: len }))}>최근</button>}
      </div>
    </div>
  )
}

export function Sparkline({ values, width = 72, height = 28 }) {
  if (!values || values.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`)
  const up = values[values.length - 1] >= values[0]
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}
