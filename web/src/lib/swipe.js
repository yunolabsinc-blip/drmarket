import { useEffect, useRef } from 'react'
import { go } from './router'
import { TABS, activeTab } from '../components/ui'

// 좌우로 밀어 옆 탭으로 이동 (홈 ↔ 일정 ↔ 순위 ↔ 시장 ↔ 관심)
// 차트·가로 스크롤 목록·입력창 위에서 시작한 동작, 대각선·느린 끌기는 무시한다.
const MIN_DX = 70
const MAX_MS = 700
const EDGE = 24   // 화면 가장자리는 브라우저 뒤로 가기 제스처에 양보

function blocked(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.matches?.('input, textarea, select, canvas, svg, [data-noswipe], .chart, .sheet, .modal')) return true
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

export function useTabSwipe(route, enabled) {
  const start = useRef(null)
  const routeRef = useRef(route)
  routeRef.current = route

  useEffect(() => {
    if (!enabled) return
    const onStart = (e) => {
      start.current = null
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return
      if (blocked(e.target)) return
      start.current = { x: t.clientX, y: t.clientY, at: Date.now() }
    }
    const onEnd = (e) => {
      const s = start.current
      start.current = null
      if (!s || e.changedTouches.length !== 1) return
      const t = e.changedTouches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - s.at > MAX_MS) return
      if (window.getSelection?.().toString()) return
      const { page, param } = routeRef.current
      const i = TABS.findIndex((tab) => tab.id === activeTab(page, param))
      if (i < 0) return
      const next = TABS[i + (dx < 0 ? 1 : -1)]
      if (!next) return
      document.documentElement.dataset.swipe = dx < 0 ? 'next' : 'prev'
      setTimeout(() => { delete document.documentElement.dataset.swipe }, 350)
      go(next.path)
    }
    const onCancel = () => { start.current = null }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onCancel)
    }
  }, [enabled])
}
