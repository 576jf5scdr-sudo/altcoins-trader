// Altcoins Trader service worker. Bump CACHE when a shell file changes.
// data.json is network-first so a phone picks up the 15-minute publish.
// Hero video stays off this cache: iPhone Safari plays it with byte-range
// requests, and a cached full file breaks that.
const CACHE = "altcoins-v5";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./js/app.js",
  "./fonts/outfit-latin-wght-normal.woff2",
  "./img/bull-poster.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith(".mp4") || url.pathname.endsWith(".webm")) return;

  if (url.pathname.endsWith("/data.json") || url.pathname.endsWith("/sample_data.json")) {
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) {
        var cp = r.clone();
        caches.open(CACHE).then(function (c) { return c.put(url.pathname, cp); });
      }
      return r;
    }).catch(function () { return caches.match(url.pathname); }));
    return;
  }

  if (req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/")) {
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) {
        var cp = r.clone();
        caches.open(CACHE).then(function (c) { return c.put("./index.html", cp); });
      }
      return r;
    }).catch(function () { return caches.match("./index.html"); }));
    return;
  }

  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(req).then(function (r) {
      if (r.ok) {
        var cp = r.clone();
        caches.open(CACHE).then(function (c) { return c.put(req, cp); });
      }
      return r;
    });
  }));
});
