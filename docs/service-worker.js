const SHELL_CACHE = "schedule-shell-v12";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./routine.js",
  "./store.js",
  "./novel-assign.js",
  "./lectures.js",
  "./drag.js",
  "./week.js",
  "./meal-suggest.js",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 오프라인 폴백으로 보관할 대상만 고른다.
//
// 예전에는 지나가는 응답을 전부 cache.put 했는데, 그러면
//   - "./today.json?t=<타임스탬프>"가 새로고침마다 새 엔트리로 쌓여 무한히 늘고
//   - 워커(다른 오리진) 응답까지 캐시에 들어가고
//   - PATCH 요청은 cache.put이 거부해 매번 unhandled rejection이 났다.
// 그래서 "같은 오리진의 GET이면서 셸 파일이거나 today.json인 것"만 남긴다.
function cacheKeyFor(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;

  const scope = new URL("./", self.location.href).pathname;
  if (!url.pathname.startsWith(scope)) return null;
  const rel = "./" + url.pathname.slice(scope.length);

  // today.json은 캐시 무효화용 ?t= 를 달고 오므로 쿼리를 떼서 한 자리에 덮어쓴다.
  if (rel === "./today.json") return new Request(url.origin + url.pathname);
  if (rel === "./" || SHELL_FILES.includes(rel)) return request;
  return null;
}

// 네트워크 우선 + 캐시 폴백: 온라인이면 항상 최신 파일을 받고,
// 오프라인일 때만 마지막으로 받아둔 캐시를 보여준다.
// (캐시 우선 방식은 배포한 화면을 새로 고쳐도 예전 버전이 계속 보이는
// 문제가 있어서 이 방식으로 바꿨다.)
self.addEventListener("fetch", (event) => {
  const key = cacheKeyFor(event.request);
  if (!key) return; // 캐시할 것도 폴백할 것도 없다 — 브라우저에 그냥 맡긴다.

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // 오류 응답(404 등)을 캐시에 넣으면 오프라인일 때 그 오류가 되살아난다.
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(key, copy)));
        }
        return res;
      })
      .catch(async () => (await caches.match(key)) || Response.error())
  );
});
