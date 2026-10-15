/* Only a generic offline document and immutable public build assets are cached. */
const prefix = "pictoflow-offline-shell-";
const meta = prefix + "active";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  if (
    event.data?.type !== "USE_SHELL" ||
    !/^pictoflow-offline-shell-[a-f0-9]{64}$/.test(event.data.name)
  )
    return;
  event.waitUntil(
    (async () => {
      const client = event.source?.id
        ? await self.clients.get(event.source.id)
        : null;
      if (!client || new URL(client.url).origin !== self.location.origin)
        return;
      const cache = await caches.open(event.data.name);
      if (!(await cache.match("/offline"))) {
        event.ports[0]?.postMessage("failed");
        return;
      }
      await (
        await caches.open(meta)
      ).put("/offline-active", new Response(event.data.name));
      event.ports[0]?.postMessage("ready");
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.search ||
    !(url.pathname === "/offline" || url.pathname.startsWith("/_next/static/"))
  )
    return;
  // Never serve the HTML shell as a React Server Component response.
  if (url.pathname === "/offline" && event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) return response;
      } catch {}
      const active = await (await caches.open(meta)).match("/offline-active");
      if (active) {
        const response = await (
          await caches.open(await active.text())
        ).match(url.pathname);
        if (response) return response;
      }
      return Response.error();
    })(),
  );
});
