// ---------------------------------------------------------------------------
// 이 폴더(/pohang-orchard-demo/)만 맡는 서비스워커 — 아무것도 캐시하지 않는다.
//
// 왜 필요한가: djgnfj-svg.github.io 루트의 블로그(Chirpy 테마)가 origin 전체를 범위로 하는
// 서비스워커를 등록해 두었고, 전략이 캐시 우선(caches.match → 없으면 fetch)이다. 그래서 이 데모의
// index.html이 한 번 그 캐시에 들어가면 배포를 해도 옛 화면이 계속 나오고 Ctrl+Shift+R로만 넘어갔다.
// 서비스워커는 범위가 더 좁은 쪽이 이기므로, 이 파일을 등록하면 이 경로는 루트 것이 손대지 못한다.
// fetch를 가로채지 않으니 모든 요청은 평소대로 네트워크로 간다.
// ---------------------------------------------------------------------------
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(purgeScope());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(Promise.all([purgeScope(), self.clients.claim()]));
});

// 루트 서비스워커가 이미 담아 둔 이 경로의 응답을 지운다 (다른 경로는 그대로 둔다)
async function purgeScope() {
  const scope = new URL(self.registration.scope).pathname;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (new URL(req.url).pathname.startsWith(scope)) await cache.delete(req);
    }
  }
}
