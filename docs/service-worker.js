// OneSignal의 푸시 알림 처리 코드를 이 서비스워커에 얹는다.
// (서비스워커는 스코프당 하나만 두는 게 안전해서, 별도 OneSignalSDKWorker.js를
// 두는 대신 우리 서비스워커에 합쳤다.)
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const SHELL_CACHE = "schedule-shell-v2";
const SHELL_FILES = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

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

// 네트워크 우선 + 캐시 폴백: 온라인이면 항상 최신 파일을 받고,
// 오프라인일 때만 마지막으로 받아둔 캐시를 보여준다.
// (캐시 우선 방식은 배포한 화면을 새로 고쳐도 예전 버전이 계속 보이는
// 문제가 있어서 이 방식으로 바꿨다.)
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
