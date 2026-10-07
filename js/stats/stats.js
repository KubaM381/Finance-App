// Reiter „Statistiken“: Auswertung (Kategorien, Verlauf, größte Ausgaben), Budgets und Sparziele.
// Umbuchungen zwischen eigenen Konten sind bereits herausgefiltert (listTransactions).
import { listTransactions, formatMoney, formatDate } from "../transactions/transactions.js";
import { el } from "../contracts/view.js";
import { renderBudgets, renderGoals } from "../planning/planning.js";

const TABS = [["auswertung", "Auswertung"], ["budgets", "Budgets"], ["ziele", "Sparziele"]];
const state = { tab: "auswertung", period: "", transactions: [] };
let tabsEl = null, body = null;

const monthLabel = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonth = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "short", timeZone: "UTC" }).replace(".", "");
const shift = (ym, n) => { const total = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n; return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`; };

const inPeriod = (t) => state.period === "all" || t.date.startsWith(state.period);
const sum = (list) => list.reduce((s, t) => s + Math.abs(t.amount), 0);

function periodSelect(months) {
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse();
  const select = el("select", { id: "st-period", "aria-label": "Zeitraum" },
    ...months.slice().reverse().map((m) => el("option", { value: m, text: monthLabel(m) })),
    ...years.map((y) => el("option", { value: y, text: `Jahr ${y}` })),
    el("option", { value: "all", text: "Gesamter Zeitraum" }));
  select.value = state.period;
  select.addEventListener("change", () => { state.period = select.value; render(); });
  return select;
}

function summaryCard(label, value, kind) {
  return el("article", { class: "card" }, el("p", { class: "card-label", text: label }), el("p", { class: `card-value num${kind ? ` st-${kind}` : ""}`, text: value }));
}

function history(months) {
  const last = months[months.length - 1];
  const range = Array.from({ length: 12 }, (_, i) => shift(last, i - 11));
  const totals = range.map((ym) => {
    const list = state.transactions.filter((t) => t.date.startsWith(ym));
    return { ym, income: sum(list.filter((t) => t.amount > 0)), expenses: sum(list.filter((t) => t.amount < 0)) };
  });
  const max = Math.max(1, ...totals.flatMap((t) => [t.income, t.expenses]));
  const col = (t) => {
    const bar = (value, cls) => { const b = el("span", { class: `st-bar ${cls}`, title: formatMoney(value) }); b.style.height = `${Math.round((value / max) * 100)}%`; return b; };
    return el("button", { type: "button", class: `st-col${t.ym === state.period ? " is-active" : ""}`, "data-month": t.ym, "aria-label": `${monthLabel(t.ym)}: Einnahmen ${formatMoney(t.income)}, Ausgaben ${formatMoney(t.expenses)}` },
      el("span", { class: "st-bars" }, bar(t.income, "in"), bar(t.expenses, "out")), el("span", { class: "st-label", text: shortMonth(t.ym) }));
  };
  return el("section", { class: "card ko-card" },
    el("h2", { class: "ko-h", text: "Verlauf der letzten 12 Monate" }),
    el("div", { class: "st-chart" }, ...totals.map(col)),
    el("p", { class: "card-note st-legend" }, el("span", { class: "st-key in" }), " Einnahmen  ", el("span", { class: "st-key out" }), " Ausgaben · Monat antippen zum Auswählen"));
}

function renderAnalysis() {
  const months = [...new Set(state.transactions.map((t) => t.date.slice(0, 7)))].sort();
  if (!months.length) {
    body.replaceChildren(el("div", { class: "card empty" }, el("h2", { text: "Noch keine Auswertungen" }),
      el("p", { text: "Importiere Kontoauszüge unter „Transaktionen“, dann siehst du hier, wohin dein Geld fließt." })));
    return;
  }
  if (!state.period || (state.period !== "all" && !months.some((m) => m.startsWith(state.period)))) state.period = months[months.length - 1];
  const list = state.transactions.filter(inPeriod);
  const expenses = list.filter((t) => t.amount < 0), income = sum(list.filter((t) => t.amount > 0)), spent = sum(expenses);

  const byCat = new Map();
  for (const t of expenses) byCat.set(t.category, (byCat.get(t.category) || 0) - t.amount);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const catRows = cats.map(([name, value]) => {
    const share = spent ? value / spent : 0;
    const fill = el("span", { class: "bar-fill b-goal" });
    fill.style.width = `${Math.round(share * 100)}%`;
    return el("li", { class: "pl-item" },
      el("div", { class: "pl-head" }, el("span", { class: "ko-item-label", text: name }), el("span", { class: "num", text: `${formatMoney(value)} · ${Math.round(share * 100)} %` })),
      el("div", { class: "bar" }, fill));
  });

  const top = [...expenses].sort((a, b) => a.amount - b.amount).slice(0, 5);
  body.replaceChildren(
    el("div", { class: "ko-nav" }, periodSelect(months)),
    el("div", { class: "dash st-summary" },
      summaryCard("Einnahmen", formatMoney(income), "in"), summaryCard("Ausgaben", formatMoney(spent), "out"),
      summaryCard("Saldo", formatMoney(income - spent, "EUR", { sign: true }), income - spent >= 0 ? "in" : "out")),
    history(months),
    el("section", { class: "card ko-card" }, el("h2", { class: "ko-h", text: "Ausgaben nach Kategorie" }),
      cats.length ? el("ul", { class: "ko-items pl-list" }, ...catRows) : el("p", { class: "card-note", text: "Keine Ausgaben in diesem Zeitraum." })),
    el("section", { class: "card ko-card" }, el("h2", { class: "ko-h", text: "Größte Ausgaben" }),
      top.length ? el("ul", { class: "ko-items" }, ...top.map((t) => el("li", { class: "ko-item" },
        el("div", { class: "ko-item-main" }, el("span", { class: "ko-item-label", text: t.payee || t.purpose || "(ohne Text)" }), el("span", { class: "ko-tags", text: `${t.category} · ${formatDate(t.date)}` })),
        el("span", { class: "num", text: formatMoney(t.amount, t.currency, { sign: true }) })))) : el("p", { class: "card-note", text: "Keine Ausgaben in diesem Zeitraum." })));
  body.querySelectorAll("[data-month]").forEach((b) => b.addEventListener("click", () => { state.period = b.dataset.month; render(); }));
}

async function render() {
  tabsEl.replaceChildren(...TABS.map(([id, label]) =>
    el("button", { type: "button", role: "tab", class: "seg-btn", "data-tab": id, "aria-selected": String(state.tab === id), text: label })));
  try {
    if (state.tab === "auswertung") return renderAnalysis();
    const latest = state.transactions.reduce((m, t) => (t.date > m ? t.date : m), "").slice(0, 7);
    const ym = latest || new Date().toISOString().slice(0, 7);
    const again = () => render();
    if (state.tab === "budgets") await renderBudgets(body, { transactions: state.transactions, ym }, again);
    else await renderGoals(body, {}, again);
  } catch (error) {
    body.replaceChildren(el("div", { class: "notice error", text: `Konnte nicht geladen werden: ${error?.message || error}` }));
  }
}

async function refresh() {
  try { state.transactions = await listTransactions(); } catch (error) {
    body.replaceChildren(el("div", { class: "notice error", text: `Daten konnten nicht geladen werden: ${error?.message || error}` }));
    return;
  }
  render();
}

export function initStats() {
  tabsEl = document.getElementById("st-tabs");
  body = document.getElementById("st-body");
  if (!tabsEl || !body) return;
  tabsEl.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]")?.dataset.tab;
    if (tab) { state.tab = tab; render(); }
  });
  const onNavigate = () => { if (location.hash === "#statistiken") refresh(); };
  window.addEventListener("hashchange", onNavigate);
  onNavigate();
}
