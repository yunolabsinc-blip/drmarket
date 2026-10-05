// 닥터마켓 로고: 맥박 선이 상승 화살표로 이어지는 심볼 + 워드마크
export function LogoMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--brand)" />
      <path d="M12 36h9l5-12 8 22 6-14h4" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M44 32l8-8m0 0h-7m7 0v7" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Logo({ size = 28 }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-text">닥터마켓</span>
    </span>
  )
}
