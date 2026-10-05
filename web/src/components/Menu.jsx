import { useEffect } from 'react'
import Logo from './Logo'
import { CloseIcon } from './ui'

const LINKS = [
  { href: '#/', label: '홈' },
  { href: '#/themes', label: '실시간 테마' },
  { href: '#/rank', label: '순위' },
  { href: '#/market', label: '시장종합' },
  { href: '#/watch', label: '관심종목' },
]

export default function Menu({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="menu-layer" role="dialog" aria-modal="true" aria-label="메뉴" onClick={onClose}>
      <aside className="menu-panel" onClick={(e) => e.stopPropagation()}>
        <div className="menu-head">
          <Logo size={26} />
          <button className="icon-btn" onClick={onClose} aria-label="닫기"><CloseIcon /></button>
        </div>
        <nav className="menu-links">
          {LINKS.map((l) => <a key={l.href} href={l.href} onClick={onClose}>{l.label}</a>)}
        </nav>
        <div className="menu-info">
          <b>서비스 안내</b>
          <p>시세는 한국투자증권 Open API의 KRX·넥스트레이드 통합 시세이며, 프리마켓(08:00)부터 애프터마켓(20:00)까지 5초 간격으로 갱신됩니다. 순위는 KRX 체결 기준이고, 테마 분류는 닥터마켓 자체 기준입니다.</p>
          <p>닥터마켓의 정보는 투자 참고용이며 투자 권유가 아닙니다. 투자 판단과 결과의 책임은 이용자에게 있습니다.</p>
        </div>
      </aside>
    </div>
  )
}
