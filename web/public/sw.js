// 앱 화면 파일을 휴대폰에 저장해 두고, 다시 열 때 네트워크를 기다리지 않고 바로 띄움
// - 화면(HTML)·종목 목록: 저장본을 먼저 보여 주고 뒤에서 새 버전 받기 (다음에 열 때 반영)
// - 빌드 파일(assets/, 이름에 해시)·글꼴: 한 번 받으면 저장본 사용
// - 시세 API는 건드리지 않음
const CACHE = 'drm-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

const cacheFirst = async (req) => {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok || res.type === 'opaque') {
    await cache.put(req, res.clone())
    prune(cache)
  }
  return res
}

// 새 버전이 나올 때마다 빌드 파일이 쌓이므로 오래된 것부터 지움
const prune = async (cache) => {
  const assets = (await cache.keys()).filter((r) => r.url.includes('/assets/'))
  for (const r of assets.slice(0, Math.max(0, assets.length - 40))) await cache.delete(r)
}

const staleWhileRevalidate = async (req, key) => {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(key)
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone())
    return res
  })
  if (hit) {
    fresh.catch(() => {})
    return hit
  }
  return fresh
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const scope = new URL(self.registration.scope)

  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    const path = url.pathname.slice(scope.pathname.length)
    if (req.mode === 'navigate' || path === '' || path === 'index.html') {
      e.respondWith(staleWhileRevalidate(req, scope.href))
    } else if (path.startsWith('assets/')) {
      e.respondWith(cacheFirst(req))
    } else if (path === 'stocks.json' || /\.(png|svg|webmanifest)$/.test(path)) {
      e.respondWith(staleWhileRevalidate(req, req))
    }
    return
  }
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/pretendard')) {
    e.respondWith(cacheFirst(req))
  }
})
