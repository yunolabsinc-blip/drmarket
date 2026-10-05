import { useEffect, useState } from 'react'

// 해시 라우팅: #/ · #/themes · #/theme/:id · #/rank · #/watch · #/stock/:code
// (정적 호스팅에서 새로고침·공유 링크가 그대로 동작)
const parse = () => {
  const parts = (window.location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean)
  return { page: parts[0] || 'home', param: parts[1] ? decodeURIComponent(parts[1]) : null }
}

export function useRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => {
      setRoute(parse())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (path) => {
  window.location.hash = path
}

export const back = () => {
  if (window.history.length > 1) window.history.back()
  else go('/')
}
