export const shellPrefix = "pictoflow-offline-shell-";
export const shellMeta = shellPrefix + "active";
export async function prepareOfflineShell() {
  if (
    !globalThis.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !crypto.subtle
  )
    throw new Error(
      "La réouverture hors connexion demande HTTPS et un navigateur compatible.",
    );
  await navigator.serviceWorker.register("/offline-sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  const response = await fetch("/offline", {
    cache: "no-store",
    credentials: "omit",
  });
  if (
    !response.ok ||
    response.redirected ||
    !response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error("L’écran hors connexion n’a pas pu être préparé.");
  const html = await response.clone().text();
  const document = new DOMParser().parseFromString(html, "text/html");
  const assets = [...document.querySelectorAll("script[src],link[href]")]
    .map(
      (element) =>
        new URL(
          element.getAttribute("src") ?? element.getAttribute("href")!,
          location.origin,
        ),
    )
    .filter(
      (url) =>
        url.origin === location.origin &&
        url.pathname.startsWith("/_next/static/"),
    )
    .map((url) => url.href);
  if (!assets.some((url) => new URL(url).pathname.endsWith(".js")))
    throw new Error("Les fichiers de l’écran hors connexion sont incomplets.");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          html +
            Array.from(crypto.getRandomValues(new Uint8Array(16))).join(","),
        ),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const name = shellPrefix + hash;
  const cache = await caches.open(name);
  try {
    await cache.addAll([...new Set(assets)]);
    await cache.put("/offline", response);
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(
        () =>
          reject(new Error("L’écran local n’a pas confirmé sa préparation.")),
        10000,
      );
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        event.data === "ready"
          ? resolve()
          : reject(new Error("Préparation locale impossible."));
      };
      registration.active?.postMessage({ type: "USE_SHELL", name }, [
        channel.port2,
      ]);
    });
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}
