import { useEffect, useState } from 'react'
import { track } from '../lib/analytics'
import { CloseIcon } from './ui'

// 안드로이드 크롬 등은 설치 창을 직접 띄울 수 있다 (앱 시작 시 이벤트를 받아 둔다)
let deferred = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e
})

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export async function startInstall() {
  if (deferred) {
    deferred.prompt()
    const r = await deferred.userChoice.catch(() => null)
    if (r?.outcome === 'accepted') track('install')
    deferred = null
    return 'prompted'
  }
  return isStandalone() ? 'installed' : isIOS() ? 'ios' : 'manual'
}

// 직접 설치 창을 못 띄우는 경우(아이폰 사파리 등) 방법 안내
export function InstallGuide({ mode, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet-layer" onClick={onClose} role="dialog" aria-modal="true" aria-label="홈 화면에 추가">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b className="sheet-title">홈 화면에 추가</b>
          <button className="icon-btn" onClick={onClose} aria-label="닫기"><CloseIcon /></button>
        </div>
        {mode === 'installed' ? (
          <p className="fb-desc">이미 홈 화면 앱으로 실행 중입니다.</p>
        ) : mode === 'ios' ? (
          <ol className="install-steps">
            <li><b>사파리</b>에서 이 페이지를 열어 주세요. (다른 앱 안의 브라우저에서는 안 됩니다)</li>
            <li>화면 아래의 <b>공유 버튼</b> <span className="ios-share" aria-hidden="true">⬆︎</span> 을 누르세요.</li>
            <li>목록에서 <b>홈 화면에 추가</b>를 누르고, 오른쪽 위 <b>추가</b>를 누르면 끝입니다.</li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>브라우저 오른쪽 위의 <b>메뉴(⋮)</b>를 누르세요.</li>
            <li><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누르세요.</li>
          </ol>
        )}
        <p className="fb-note">홈 화면에 추가하면 주소창 없이 앱처럼 열리고, 아이폰에서는 나중에 알림을 받을 때도 필요합니다.</p>
      </div>
    </div>
  )
}

export function useInstallGuide() {
  const [mode, setMode] = useState(null)
  const open = async () => {
    const r = await startInstall()
    if (r !== 'prompted') setMode(r)
  }
  return { mode, open, close: () => setMode(null) }
}
