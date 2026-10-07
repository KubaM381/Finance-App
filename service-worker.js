// Bei jeder Änderung an den App-Dateien die Versionsnummer erhöhen (v9 → v10 …).
const CACHE = "finance-app-v9";

// Nur diese statischen App-Dateien werden gecached. Alles andere läuft am Cache vorbei,
// damit niemals persönliche Daten, Importdateien oder fremde Inhalte im Cache landen.
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/base.css",
  "./css/components.css",
  "./css/responsive.css",
  "./css/extras.css",
  "./js/app.js",
  "./js/db/schema.js",
  "./js/db/database.js",
  "./js/accounts/accounts.js",
  "./js/accounts/balances.js",
  "./js/transactions/transactions.js",
  "./js/transactions/categories.js",
  "./js/transactions/rules.js",
  "./js/transactions/transfers.js",
  "./js/transactions/list.js",
  "./js/dashboard/dashboard.js",
  "./js/dashboard/overview.js",
  "./js/contracts/contracts.js",
  "./js/contracts/view.js",
  "./js/contracts/insights.js",
  "./js/stats/stats.js",
  "./js/planning/planning.js",
  "./js/settings/settings.js",
  "./js/security/security.js",
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

// Geteilte Dateien (Web Share Target): kurz in einem eigenen Cache ablegen, die App holt sie ab und löscht sie sofort.
// Der Name beginnt bewusst nicht mit "finance-app-", damit "activate" ihn nicht anfasst.
const SHARE_CACHE = "finance-share-inbox";
const SHARE_PATH = new URL("./share-target", self.location).pathname;

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

  if (request.method === "POST" && new URL(request.url).pathname === SHARE_PATH) {
    event.respondWith(receiveShare(request));
    return;
  }

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  url.search = "";
  url.hash = "";
  const key = url.href;
  if (!SHELL_URLS.has(key)) return;

  event.respondWith(respond(event, request, key));
});

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((f) => typeof f === "object" && f && "name" in f);
    const cache = await caches.open(SHARE_CACHE);
    await Promise.all((await cache.keys()).map((key) => cache.delete(key)));
    await Promise.all(files.map((file, i) =>
      cache.put(
        new URL(`./shared/${i}`, self.location).href,
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name)
          }
        })
      )));
  } catch {
    /* Die App öffnet sich trotzdem, es gibt dann nur nichts zu importieren. */
  }
  return Response.redirect(new URL("./?shared=1#transaktionen", self.location).href, 303);
}

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
