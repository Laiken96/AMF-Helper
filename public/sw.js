// Service Worker für Web Push (D029). Statische Datei ohne Build Abhängigkeiten.
// Erwartete Nutzlast siehe PushPayload in src/core/push-config.ts: { title, body, url, tag }.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePayload(data) {
  const fallback = { title: "NFL Tipps", body: "", url: "", tag: "nfl-tipps" };
  if (!data) return fallback;
  try {
    const json = data.json();
    return {
      title: typeof json.title === "string" && json.title ? json.title : fallback.title,
      body: typeof json.body === "string" ? json.body : "",
      url: typeof json.url === "string" ? json.url : "",
      tag: typeof json.tag === "string" && json.tag ? json.tag : fallback.tag,
    };
  } catch {
    return { ...fallback, body: data.text() };
  }
}

self.addEventListener("push", (event) => {
  const p = parsePayload(event.data);
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: p.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const rel = (event.notification.data && event.notification.data.url) || "";
  let target;
  try {
    target = new URL(rel, scope).href;
  } catch {
    target = scope;
  }
  if (!target.startsWith(scope)) target = scope;

  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of list) {
        if (client.url.startsWith(scope)) {
          await client.focus();
          if (client.url !== target && "navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              // Navigation nicht möglich, die App ist trotzdem im Vordergrund.
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
