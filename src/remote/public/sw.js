// NeZha 远程面板 Service Worker
// - 离线：app 外壳网络优先、缓存兜底；/api 与 /sw.js 永不缓存。
// - 推送：push 处理器已就绪，待桌面接通 VAPID 发送端即可锁屏通知（B5b）。
const CACHE = "nezha-remote-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.pathname.startsWith("/api/") || u.pathname === "/sw.js") return; // 实时数据/自身不缓存
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const clone = r.clone();
        if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, clone));
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});

// Web Push：负载内含上下文（标题/正文/深链），锁屏直接可见。
self.addEventListener("push", (e) => {
  if (!e.data) return;
  let d = {};
  try {
    d = e.data.json();
  } catch {
    d = { body: e.data.text() };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "NeZha", {
      body: d.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: d.tag || "nezha",
      data: d,
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});
