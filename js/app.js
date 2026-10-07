// App-Sperre: Inhalte sofort verbergen, bevor das Sperrmodul geladen ist (verhindert kurzes Aufblitzen).
try { if (localStorage.getItem("finance-lock-pin")) document.documentElement.classList.add("locked"); } catch { /* optional */ }

const VIEWS = {
  dashboard: "Übersicht",
  konto: "Konto",
  transaktionen: "Transaktionen",
  vertraege: "Verträge",
  statistiken: "Statistiken",
  einstellungen: "Einstellungen"
};
const DEFAULT_VIEW = "dashboard";

const viewElements = document.querySelectorAll("[data-view]");
const navLinks = document.querySelectorAll("[data-nav]");
let firstRender = true;

const currentView = () => {
  const name = location.hash.slice(1);
  return Object.prototype.hasOwnProperty.call(VIEWS, name) ? name : DEFAULT_VIEW;
};

const showView = () => {
  const name = currentView();

  viewElements.forEach((element) => {
    element.hidden = element.dataset.view !== name;
  });

  navLinks.forEach((link) => {
    if (link.dataset.nav === name) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  document.title = name === DEFAULT_VIEW ? "Finance App" : `${VIEWS[name]} – Finance App`;

  if (!firstRender) {
    window.scrollTo(0, 0);
    const heading = document.querySelector(`[data-view="${name}"] h1`);
    if (heading) heading.focus({ preventScroll: true });
  }
  firstRender = false;
};

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) return;

  // Nach einem Update übernimmt der neue Service Worker die Seite: einmal neu laden,
  // damit sofort die aktuellen Dateien angezeigt werden.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    console.error("Service worker registration failed:", error);
  }
};

showView();
window.addEventListener("hashchange", showView);
window.addEventListener("load", registerServiceWorker);

// Import-Funktion separat laden: Fehler dort dürfen Navigation und Grundfunktionen der App nicht blockieren.
import("./import/importer.js")
  .then((module) => module.initImport())
  .catch((error) => console.error("Import konnte nicht gestartet werden:", error));

// Reiter „Verträge“ ebenfalls separat laden (Fehler dort blockieren die restliche App nicht).
import("./contracts/view.js")
  .then((module) => module.initContracts())
  .catch((error) => console.error("Verträge konnten nicht gestartet werden:", error));

// Reiter „Konto“ (Monatsübersicht) ebenfalls separat laden.
import("./dashboard/dashboard.js")
  .then((module) => module.initKonto())
  .catch((error) => console.error("Konto-Übersicht konnte nicht gestartet werden:", error));

// Reiter „Übersicht“ (echte Daten statt Beispielwerten) ebenfalls separat laden.
import("./dashboard/overview.js")
  .then((module) => module.initOverview())
  .catch((error) => console.error("Übersicht konnte nicht gestartet werden:", error));

// Statistiken (Auswertung, Budgets, Sparziele)
import("./stats/stats.js")
  .then((module) => module.initStats())
  .catch((error) => console.error("Statistiken konnten nicht gestartet werden:", error));

// Einstellungen (Kontostände, Sperre, Kategorie-Regeln)
import("./settings/settings.js")
  .then((module) => module.initSettings())
  .catch((error) => console.error("Einstellungen konnten nicht gestartet werden:", error));

// App-Sperre
import("./security/security.js")
  .then((module) => module.initSecurity())
  .catch((error) => {
    console.error("App-Sperre konnte nicht gestartet werden:", error);
    document.documentElement.classList.remove("locked");
  });
