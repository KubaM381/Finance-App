// Reiter „Übersicht“: Kennzahlen des letzten Monats mit Buchungen und die neuesten Transaktionen.
// Alles live aus IndexedDB, keine Beispieldaten.
import { listTransactions, formatMoney, formatDate, compareByDateDesc } from "../transactions/transactions.js";
import { el } from "../contracts/view.js";

let body = null;

const monthLabel = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

function svgIcon(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

function statCard(label, value, note, icon, kind) {
  return el("article", { class: "card" },
    el("div", { class: "stat-head" },
      el("span", { class: `stat-icon ${kind}` }, svgIcon(icon)),
      el("p", { class: "card-label", text: label })),
    el("p", { class: "card-value num", text: value }),
    el("p", { class: "card-note", text: note }));
}

function render(transactions) {
  if (!transactions.length) {
    body.replaceChildren(el("div", { class: "card empty" },
      el("h2", { text: "Noch keine Daten" }),
      el("p", { text: "Importiere einen Kontoauszug unter „Transaktionen“, dann erscheint hier deine Übersicht." }),
      el("a", { class: "btn btn-primary", href: "#transaktionen", text: "Zum Import" })));
    return;
  }

  const sorted = [...transactions].sort(compareByDateDesc);
  const ym = sorted[0].date.slice(0, 7);
  let income = 0, expenses = 0;
  for (const t of transactions) {
    if (!t.date.startsWith(ym)) continue;
    if (t.amount > 0) income += t.amount;
    else expenses -= t.amount;
  }
  const net = income - expenses;
  const rate = income > 0 ? Math.max(0, Math.min(100, Math.round((net / income) * 100))) : 0;
  const meter = el("span");
  meter.style.width = `${rate}%`;

  const hero = el("article", { class: `hero ko-hero${net < 0 ? " neg" : ""}` },
    el("p", { class: "card-label", text: `Saldo ${monthLabel(ym)}` }),
    el("p", { class: "hero-value num", text: formatMoney(net, "EUR", { sign: true }) }),
    el("p", { class: "hero-delta num", text: `${formatMoney(income)} Einnahmen − ${formatMoney(expenses)} Ausgaben` }));

  const latest = el("article", { class: "card tx-card" },
    el("div", { class: "section-head" },
      el("h2", { text: "Letzte Transaktionen" }),
      el("a", { class: "link", href: "#transaktionen", text: "Alle anzeigen" })),
    el("ul", { class: "tx-list" }, ...sorted.slice(0, 5).map((t) =>
      el("li", { class: "tx" },
        el("span", { class: "avatar", "aria-hidden": "true", text: (t.payee || t.purpose || "?").trim().charAt(0).toUpperCase() || "?" }),
        el("div", { class: "tx-main" },
          el("p", { class: "tx-name", text: t.payee || t.purpose || "(ohne Text)" }),
          el("p", { class: "tx-meta", text: `${t.category} · ${formatDate(t.date)}` })),
        el("span", { class: `amount num${t.amount > 0 ? " pos" : ""}`, text: formatMoney(t.amount, t.currency, { sign: true }) })))));

  body.replaceChildren(el("div", { class: "dash" },
    hero,
    statCard("Einnahmen", formatMoney(income), monthLabel(ym), "i-down", "in"),
    statCard("Ausgaben", formatMoney(expenses), monthLabel(ym), "i-up", "out"),
    el("article", { class: "card" },
      el("p", { class: "card-label", text: "Sparquote" }),
      el("p", { class: "card-value num", text: `${rate} %` }),
      el("div", { class: "meter", role: "img", "aria-label": `Sparquote ${rate} Prozent` }, meter)),
    latest));
}

async function refresh() {
  try {
    render(await listTransactions());
  } catch (error) {
    body.replaceChildren(el("div", { class: "notice error", text: `Daten konnten nicht geladen werden: ${error?.message || error}` }));
  }
}

export function initOverview() {
  body = document.getElementById("db-body");
  if (!body) return;
  const onNavigate = () => { if (!location.hash || location.hash === "#dashboard") refresh(); };
  window.addEventListener("hashchange", onNavigate);
  onNavigate();
}
