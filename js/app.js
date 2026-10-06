const VIEWS = {
  dashboard: "Übersicht",
  konten: "Konten",
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
