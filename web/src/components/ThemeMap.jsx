import { useEffect, useMemo, useRef, useState } from 'react'
import { useMarket } from '../lib/store'
import { fmtRate, fmtWonShort } from '../lib/format'
import { go } from '../lib/router'
import { track } from '../lib/analytics'

// 테마 지도: 원 크기 = 테마 당일 거래대금, 색 = 평균 등락률(빨강 상승·파랑 하락, 진할수록 크게 움직임)
// 반도체처럼 한두 테마가 압도적이라 면적 비례 대신 완만하게(거래대금^0.3) 키운다
// 화면 너비에 맞춰 배치(좌표 = 화면 px) — 휴대폰에서 줄어들어 글자가 깨알처럼 되지 않게
const ratio = (w) => (w < 480 ? 0.95 : 0.62)   // 좁으면 정사각형에 가깝게
const maxCount = (w) => (w < 480 ? 15 : 18)     // 너무 많으면 글자가 안 보여 거래대금 상위만

// 큰 원부터 가운데에서 바깥으로 나선을 그리며 겹치지 않는 첫 자리에 놓는다
function pack(items, xf, yf) {
  const placed = []
  for (const it of items) {
    let spot = null
    if (!placed.length) spot = { x: 0, y: 0 }
    for (let a = 0, d = 0; !spot && d < 400; a += 0.2, d = a * 1.1) {
      const x = Math.cos(a) * d * xf   // 화면 비율대로 가로·세로로 퍼짐
      const y = Math.sin(a) * d * yf
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + it.r + 1.5)) spot = { x, y }
    }
    placed.push({ ...it, ...(spot || { x: 0, y: 0 }) })
  }
  return placed
}

function fill(avg) {
  if (avg === null || Math.abs(avg) < 0.05) return { bg: 'rgba(139, 149, 161, 0.28)', fg: 'var(--text-2)' }
  const t = Math.min(Math.abs(avg) / 4, 1)   // ±4% 이상이면 가장 진하게
  const alpha = 0.22 + t * 0.78
  const rgb = avg > 0 ? '240, 68, 82' : '49, 130, 246'
  return { bg: `rgba(${rgb}, ${alpha.toFixed(2)})`, fg: alpha > 0.55 ? '#fff' : avg > 0 ? 'var(--up)' : 'var(--down)' }
}

export default function ThemeMap() {
  const { themes } = useMarket()
  const box = useRef(null)
  const [width, setWidth] = useState(340)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width / 20) * 20 || 340))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const top = themes.filter((t) => t.value > 0).sort((a, b) => b.value - a.value).slice(0, maxCount(width))
  // 시세가 바뀔 때마다 자리가 흔들리지 않게 크기를 단계로 묶어서 같으면 배치를 다시 하지 않음
  const weight = (v) => Math.pow(v, 0.3)
  const sizeKey = top.map((t) => `${t.id}:${Math.round(weight(t.value) / weight(top[0]?.value || 1) * 20)}`).join('|')
  const layout = useMemo(() => {
    if (!top.length) return null
    const W = width
    const H = width * ratio(width)
    const area = top.reduce((s, t) => s + weight(t.value) ** 2, 0)
    const k = Math.sqrt((W * H * 0.6) / (Math.PI * area))
    const xf = Math.sqrt(W / H)
    const circles = pack(top.map((t) => ({ id: t.id, r: Math.max(26, weight(t.value) * k) })), xf, 1 / xf)
    const x0 = Math.min(...circles.map((c) => c.x - c.r)) - 4
    const x1 = Math.max(...circles.map((c) => c.x + c.r)) + 4
    const y0 = Math.min(...circles.map((c) => c.y - c.r)) - 4
    const y1 = Math.max(...circles.map((c) => c.y + c.r)) + 4
    return { circles, box: `${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}` }
  }, [sizeKey, width])
  // 너비를 재는 바깥 상자는 늘 같은 요소로 둠 (빈 상태 → 지도로 바뀌어도 계속 잼)
  if (!layout) return <div ref={box}><div className="skeleton" style={{ height: 240, borderRadius: 16 }} /></div>
  const byId = Object.fromEntries(top.map((t) => [t.id, t]))
  return (
    <div ref={box}><div className="card theme-map">
      <svg viewBox={layout.box} role="img" aria-label="테마 지도: 원 크기는 거래대금, 색은 평균 등락률">
        {layout.circles.map((c) => {
          const t = byId[c.id]
          if (!t) return null
          const { bg, fg } = fill(t.avg)
          // 원 안에 들어가게: 짧은 이름(· 앞부분)부터, 글자 크기는 원 지름에 맞춤
          const name = t.name.length > 5 && c.r < 34 ? t.name.split('·')[0] : t.name
          const size = Math.max(9, Math.min(15, c.r / 2.4, (c.r * 1.8) / Math.max(name.length, 2)))   // 9px보다 작아지지 않게
          return (
            <g key={c.id} className="tm-bubble" style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
              onClick={() => { track('theme_open'); go(`/theme/${t.id}`) }}>
              <title>{`${t.name} ${fmtRate(t.avg ?? 0)} · 거래대금 ${fmtWonShort(t.value)}`}</title>
              <circle r={c.r} fill={bg} />
              <text y={c.r >= 26 ? -size * 0.25 : size * 0.35} fontSize={size} fill={fg} textAnchor="middle" fontWeight="700">{name}</text>
              {c.r >= 26 && (
                <text y={size * 1.05} fontSize={Math.max(8.5, size * 0.85)} fill={fg} textAnchor="middle" fontWeight="600">{fmtRate(t.avg ?? 0)}</text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="tm-legend">원 크기 = 오늘 거래대금 · 색 = 평균 등락률 (거래대금 상위 {top.length}개 테마)</p>
    </div></div>
  )
}
