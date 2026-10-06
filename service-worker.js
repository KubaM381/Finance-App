// Bei jeder Änderung an den App-Dateien die Versionsnummer erhöhen (v5 → v6 …).
const CACHE = "finance-app-v5";

// Nur diese statischen App-Dateien werden gecached. Alles andere läuft am Cache vorbei,
// damit niemals persönliche Daten, Importdateien oder fremde Inhalte im Cache landen.
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/base.css",
  "./css/components.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/db/schema.js",
  "./js/db/database.js",
  "./js/accounts/accounts.js",
  "./js/transactions/transactions.js",
  "./js/transactions/categories.js",
  "./js/dashboard/dashboard.js",
  "./js/contracts/contracts.js",
  "./js/contracts/view.js",
  "./js/import/importer.js",
  "./js/import/csv.js",
  "./js/import/pdf.js",
  "./js/vendor/pdfjs/pdf.min.mjs",
  "./js/vendor/pdfjs/pdf.worker.min.mjs",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

// Relative Pfade werden relativ zum Service Worker aufgelöst (also unter /Finance-App/).
const SHELL_URLS = new Set(SHELL.map((path) => new URL(path, self.location).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: "reload" umgeht den HTTP-Cache des Browsers, damit wirklich die neuesten Dateien geladen werden.
      cache.addAll(SHELL.map((path) => new Request(path, { cache: "reload" })))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("finance-app-") && key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  url.search = "";
  url.hash = "";
  const key = url.href;
  if (!SHELL_URLS.has(key)) return;

  event.respondWith(respond(event, request, key));
});

// Aus dem Cache antworten (schnell, auch offline) und im Hintergrund aktualisieren.
async function respond(event, request, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);

  const refresh = fetch(request)
    .then((response) => {
      if (response.ok && response.type === "basic") {
        cache.put(key, response.clone());
      }
      return response;
    });

  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }

  try {
    return await refresh;
  } catch (error) {
    if (request.mode === "navigate") {
      const fallback = await cache.match(new URL("./index.html", self.location).href);
      if (fallback) return fallback;
    }
    throw error;
  }
}
