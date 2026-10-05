import { useEffect, useMemo, useRef, useState } from 'react'

// 실데이터 캔들 배열 [{t,o,h,l,c,v}]을 라인(영역) 또는 캔들로 그린다. 터치·마우스로 값 확인.
export default function Chart({ candles, type = 'line', baseline, height = 220, format = (v) => v.toLocaleString() }) {
  const wrap = useRef(null)
  const [width, setWidth] = useState(320)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pad = { top: 18, right: 8, bottom: 30, left: 8 }
  const geo = useMemo(() => {
    if (!candles?.length) return null
    const lows = candles.map((d) => (type === 'candle' ? d.l : d.c))
    const highs = candles.map((d) => (type === 'candle' ? d.h : d.c))
    if (baseline) {
      lows.push(baseline)
      highs.push(baseline)
    }
    let min = Math.min(...lows)
    let max = Math.max(...highs)
    if (min === max) {
      min -= 1
      max += 1
    }
    const w = width - pad.left - pad.right
    const h = height - pad.top - pad.bottom
    const step = w / candles.length
    const x = (i) => pad.left + step * i + step / 2
    const y = (v) => pad.top + ((max - v) / (max - min)) * h
    return { min, max, step, x, y, w, h }
  }, [candles, width, height, type, baseline])

  if (!candles?.length || !geo) {
    return <div ref={wrap} className="chart-empty" style={{ height }}>차트 데이터가 없습니다</div>
  }

  const { x, y, step, min, max } = geo
  const first = baseline ?? candles[0].c
  const last = candles[candles.length - 1].c
  const color = last > first ? 'var(--up)' : last < first ? 'var(--down)' : 'var(--text-3)'
  const linePath = candles.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.c).toFixed(1)}`).join('')
  const areaPath = `${linePath}L${x(candles.length - 1).toFixed(1)},${height - pad.bottom}L${x(0).toFixed(1)},${height - pad.bottom}Z`
  const maxIdx = candles.reduce((m, d, i) => ((type === 'candle' ? d.h : d.c) > (type === 'candle' ? candles[m].h : candles[m].c) ? i : m), 0)
  const minIdx = candles.reduce((m, d, i) => ((type === 'candle' ? d.l : d.c) < (type === 'candle' ? candles[m].l : candles[m].c) ? i : m), 0)

  const onMove = (e) => {
    const rect = wrap.current.getBoundingClientRect()
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const i = Math.min(candles.length - 1, Math.max(0, Math.floor((px - pad.left) / step)))
    setHover(i)
  }
  const h = hover !== null ? candles[hover] : null
  const labelSide = (i) => (x(i) > width / 2 ? 'end' : 'start')

  return (
    <div ref={wrap} className="chart" style={{ height }}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {baseline && (
          <line x1={pad.left} x2={width - pad.right} y1={y(baseline)} y2={y(baseline)}
            stroke="var(--line-strong)" strokeDasharray="3 4" />
        )}
        {type === 'line' ? (
          <>
            <path d={areaPath} fill="url(#area)" />
            <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          </>
        ) : (
          candles.map((d, i) => {
            const up = d.c >= d.o
            const c = up ? 'var(--up)' : 'var(--down)'
            const bw = Math.max(1, step * 0.6)
            return (
              <g key={i}>
                <line x1={x(i)} x2={x(i)} y1={y(d.h)} y2={y(d.l)} stroke={c} strokeWidth="1" />
                <rect x={x(i) - bw / 2} width={bw} y={y(Math.max(d.o, d.c))}
                  height={Math.max(1, Math.abs(y(d.o) - y(d.c)))} fill={c} />
              </g>
            )
          })
        )}
        {!h && (
          <>
            <text x={x(maxIdx)} y={y(type === 'candle' ? candles[maxIdx].h : candles[maxIdx].c) - 5}
              textAnchor={labelSide(maxIdx)} className="chart-label">최고 {format(max === Infinity ? 0 : (type === 'candle' ? candles[maxIdx].h : candles[maxIdx].c))}</text>
            <text x={x(minIdx)} y={Math.min(height - pad.bottom + 12, y(type === 'candle' ? candles[minIdx].l : candles[minIdx].c) + 13)}
              textAnchor={labelSide(minIdx)} className="chart-label">최저 {format(type === 'candle' ? candles[minIdx].l : candles[minIdx].c)}</text>
          </>
        )}
        <text x={pad.left} y={height - 3} className="chart-axis">{candles[0].t}</text>
        <text x={width - pad.right} y={height - 3} textAnchor="end" className="chart-axis">{candles[candles.length - 1].t}</text>
        {h && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} stroke="var(--text-3)" strokeDasharray="2 3" />
            <circle cx={x(hover)} cy={y(h.c)} r="4" fill={color} stroke="#fff" strokeWidth="2" />
          </>
        )}
      </svg>
      {h && (
        <div className="chart-tip" style={{ [x(hover) > width / 2 ? 'right' : 'left']: 8 }}>
          <b>{format(h.c)}</b>
          <span>{h.t}</span>
          {type === 'candle' && <span>시 {format(h.o)} · 고 {format(h.h)} · 저 {format(h.l)}</span>}
        </div>
      )}
      <span className="sr-only">최저 {format(min)}, 최고 {format(max)}</span>
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
