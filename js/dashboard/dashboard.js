// Reiter „Konto“: Monatsübersicht aus den vorhandenen Transaktionen (keine zusätzliche Speicherung).
//
//   frei verfügbar = Einnahmen − (Vertragskosten + Anlagen + sonstige Ausgaben)
//
// Jede Transaktion landet genau in einer Gruppe: Einnahmen, Verträge, Anlagen oder sonstige Ausgaben.
// Verträge und Anlagen kommen aus den bestätigten Einträgen des Reiters „Verträge“ sowie (optional) aus der
// automatischen Erkennung. Für Monate nach dem letzten importierten Buchungsmonat wird eine Prognose berechnet.
import { listTransactions, formatMoney } from "../transactions/transactions.js";
import {
  INTERVAL_LABELS, listContracts, describeContract, classifyTransactions, detectRecurringIncome, matchRecurring,
  dueInMonth, costBasis, todayIso, addMonths
} from "../contracts/contracts.js";
import { el } from "../contracts/view.js";

const AUTO_KEY = "finance-konto-auto-detected";
const state = {
  txs: [], records: [], classes: new Map(), suggestions: [], incomeList: [], schedule: [],
  dataMonths: [], months: [], ym: "", auto: true, error: ""
};
let body = null;

/* ---------- Monate ---------- */

const monthOf = (iso) => iso.slice(0, 7);
const shiftMonth = (ym, n) => monthOf(addMonths(`${ym}-01`, n));
const monthLabel = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

/* ---------- Berechnung ---------- */

const BUCKETS = ["income", "contract", "investment", "other"];

export function summarizeMonth(transactions, classes, incomeList, ym) {
  const totals = { income: 0, contract: 0, investment: 0, other: 0 };
  const groups = { income: new Map(), contract: new Map(), investment: new Map(), other: new Map() };
  let count = 0;

  for (const tx of transactions) {
    if (!tx.date || !tx.date.startsWith(ym)) continue;
    count++;
    const cls = classes.get(tx.id);
    let bucket, label, tag = null, regular = false;
    if (cls?.kind === "investment") { bucket = "investment"; label = cls.name; tag = cls.source; }
    else if (tx.amount > 0) {
      bucket = "income"; label = tx.payee || tx.purpose || tx.category || "Einnahme";
      regular = Boolean(matchRecurring(incomeList, tx));
    } else if (cls?.kind === "contract") { bucket = "contract"; label = cls.name; tag = cls.source; }
    else { bucket = "other"; label = tx.category || "Sonstiges"; }

    const value = bucket === "income" ? tx.amount : -tx.amount; // Ausgaben/Anlagen als positiver Abfluss
    totals[bucket] += value;
    const entry = groups[bucket].get(label) || { label, amount: 0, count: 0, tag, regular: false };
    entry.amount += value; entry.count++; entry.regular ||= regular;
    groups[bucket].set(label, entry);
  }
  return finish(ym, false, count, totals, groups);
}

function finish(ym, forecast, count, totals, groups) {
  const items = {};
  for (const bucket of BUCKETS) items[bucket] = [...groups[bucket].values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const expenses = totals.contract + totals.investment + totals.other;
  return { ym, forecast, count, ...totals, expenses, free: totals.income - expenses, items };
}

// Prognose: regelmäßige Einnahmen und fällige Verträge/Anlagen des Monats + Ø der sonstigen Ausgaben der letzten Monate.
function forecastMonth(ym) {
  const totals = { income: 0, contract: 0, investment: 0, other: 0 };
  const groups = { income: new Map(), contract: new Map(), investment: new Map(), other: new Map() };
  const add = (bucket, label, amount, tag, regular) => {
    totals[bucket] += amount;
    groups[bucket].set(label, { label, amount, count: 1, tag, regular });
  };
  for (const entry of state.incomeList) {
    if (dueInMonth(entry.nextDate, entry.intervalMonths, ym)) add("income", entry.name, entry.varies ? entry.avgAmount : entry.amount, "forecast", true);
  }
  for (const item of state.schedule) {
    if (dueInMonth(item.nextDate, item.intervalMonths, ym)) add(item.kind, item.name, item.amount, item.source, true);
  }
  const todayMonth = monthOf(todayIso());
  const past = state.dataMonths.filter((m) => m < todayMonth);
  const basis = (past.length ? past : state.dataMonths).slice(-3);
  if (basis.length) {
    const average = Math.round(basis.reduce((sum, m) => sum + summarizeMonth(state.txs, state.classes, state.incomeList, m).other, 0) / basis.length);
    if (average > 0) add("other", "Ø sonstige Ausgaben der letzten Monate", average, "forecast", false);
  }
  return finish(ym, true, 0, totals, groups);
}

const isForecast = (ym) => !state.dataMonths.length || ym > state.dataMonths[state.dataMonths.length - 1];
const summaryFor = (ym) => (isForecast(ym) ? forecastMonth(ym) : summarizeMonth(state.txs, state.classes, state.incomeList, ym));

/* ---------- Daten laden ---------- */

function recompute() {
  const today = todayIso();
  const { classes, suggestions } = classifyTransactions(state.txs, state.records, { today, includeDetected: state.auto });
  state.classes = classes;
  state.suggestions = suggestions;
  state.incomeList = detectRecurringIncome(state.txs, { today });
  const confirmed = state.records.filter((r) => r.status === "active").map((r) => describeContract(r, state.txs, { today })).filter((v) => !v.ended);
  state.schedule = [
    ...confirmed.map((v) => ({ name: v.name, kind: v.kind, amount: costBasis(v), intervalMonths: v.intervalMonths, nextDate: v.nextDate, source: "confirmed" })),
    ...(state.auto ? suggestions.map((s) => ({ name: s.name, kind: s.kind, amount: costBasis(s), intervalMonths: s.intervalMonths, nextDate: s.nextDate, source: "detected" })) : [])
  ];

  state.dataMonths = [...new Set(state.txs.filter((t) => t.date).map((t) => monthOf(t.date)))].sort();
  const todayMonth = monthOf(today);
  const last = state.dataMonths[state.dataMonths.length - 1] || todayMonth;
  const first = state.dataMonths[0] || todayMonth;
  const end = shiftMonth(last > todayMonth ? last : todayMonth, 3);
  state.months = [];
  for (let m = first; m <= end; m = shiftMonth(m, 1)) state.months.push(m);
  if (!state.months.includes(state.ym)) state.ym = last;
}

async function refresh() {
  try {
    [state.txs, state.records] = await Promise.all([listTransactions(), listContracts()]);
    state.error = "";
    recompute();
  } catch (error) {
    state.error = `Daten konnten nicht geladen werden: ${error?.message || error}`;
  }
  render();
}

/* ---------- Darstellung ---------- */

const money = (cents) => formatMoney(cents);
const signed = (cents) => formatMoney(cents, "EUR", { sign: true });

const TAGS = { confirmed: "bestätigt", detected: "automatisch erkannt", keyword: "nicht regelmäßig", forecast: "erwartet" };

function itemRow(bucket, item) {
  const tags = [];
  if (item.regular && bucket === "income") tags.push("regelmäßig");
  if (item.tag && TAGS[item.tag]) tags.push(TAGS[item.tag]);
  const value = bucket === "income" ? item.amount : -item.amount;
  return el("li", { class: "ko-item" },
    el("div", { class: "ko-item-main" },
      el("span", { class: "ko-item-label", text: item.count > 1 ? `${item.label} (${item.count}×)` : item.label }),
      tags.length ? el("span", { class: "ko-tags", text: tags.join(" · ") }) : null),
    el("span", { class: `num${bucket === "income" ? " pos" : ""}`, text: signed(value) }));
}

function breakdownRow(bucket, label, value, share, items) {
  const bar = el("span", { class: "ko-fill" });
  bar.style.width = `${Math.max(0, Math.min(100, share * 100))}%`;
  const line = el("div", { class: "ko-line" },
    el("span", { class: "ko-dot" }), el("span", { class: "ko-label", text: label }),
    el("span", { class: `amount num${bucket === "income" ? " pos" : ""}`, text: signed(bucket === "income" ? value : -value) }));
  const head = [line, el("div", { class: "ko-bar" }, bar)];
  if (!items.length) return el("div", { class: `ko-row ko-${bucket}` }, ...head);
  return el("details", { class: `ko-row ko-${bucket}` },
    el("summary", {}, ...head),
    el("ul", { class: "ko-items" }, ...items.slice(0, 12).map((item) => itemRow(bucket, item)),
      items.length > 12 ? el("li", { class: "ko-item" }, el("span", { class: "card-note", text: `… und ${items.length - 12} weitere` })) : null));
}

function monthNav() {
  const select = el("select", { id: "ko-month", "data-act": "month", "aria-label": "Monat wählen" });
  [...state.months].reverse().forEach((ym) =>
    select.append(el("option", { value: ym, text: monthLabel(ym) + (isForecast(ym) ? " · Prognose" : "") })));
  select.value = state.ym;
  const index = state.months.indexOf(state.ym);
  return el("div", { class: "ko-nav" },
    el("button", { type: "button", class: "icon-btn", "data-act": "prev", "aria-label": "Vorheriger Monat", text: "‹", disabled: index <= 0 }),
    select,
    el("button", { type: "button", class: "icon-btn", "data-act": "next", "aria-label": "Nächster Monat", text: "›", disabled: index >= state.months.length - 1 }));
}

function render() {
  if (!body) return;
  if (state.error) { body.replaceChildren(el("div", { class: "notice error", text: state.error })); return; }
  if (!state.txs.length) {
    body.replaceChildren(el("div", { class: "card empty" },
      el("h2", { text: "Noch keine Daten" }),
      el("p", { text: "Importiere Kontoauszüge unter „Transaktionen“, dann erscheint hier deine Monatsübersicht." }),
      el("a", { class: "btn btn-primary", href: "#transaktionen", text: "Zum Import" })));
    return;
  }

  const sm = summaryFor(state.ym);
  const todayMonth = monthOf(todayIso());
  const status = sm.forecast ? "Prognose" : state.ym === todayMonth ? "Laufender Monat" : "Ist-Werte";
  const scale = Math.max(sm.income, sm.expenses, 1);

  const hero = el("article", { class: `hero ko-hero${sm.free < 0 ? " neg" : ""}` },
    el("div", { class: "ko-hero-top" }, el("p", { class: "card-label", text: "Frei verfügbar" }), el("span", { class: "chip ko-chip", text: status })),
    el("p", { class: "hero-value num", text: money(sm.free) }),
    el("p", { class: "hero-delta num", text: `${money(sm.income)} Einnahmen − ${money(sm.expenses)} Ausgaben` }),
    sm.forecast ? el("p", { class: "ko-hero-note", text: "Schätzung aus regelmäßigen Zahlungen und dem Durchschnitt der sonstigen Ausgaben der letzten Monate." }) : null,
    !sm.forecast && !sm.count ? el("p", { class: "ko-hero-note", text: "Für diesen Monat sind keine Buchungen importiert." }) : null);

  const breakdown = el("section", { class: "card ko-card", "aria-label": "Aufschlüsselung" },
    breakdownRow("income", "Einnahmen", sm.income, sm.income / scale, sm.items.income),
    breakdownRow("contract", "Verträge", sm.contract, sm.contract / scale, sm.items.contract),
    breakdownRow("investment", "Anlagen / Investitionen", sm.investment, sm.investment / scale, sm.items.investment),
    breakdownRow("other", "Sonstige Ausgaben", sm.other, sm.other / scale, sm.items.other),
    el("div", { class: "ko-sum" },
      el("div", { class: "ko-sum-row" }, el("span", { text: "Gesamtausgaben" }), el("span", { class: "num", text: signed(-sm.expenses) })),
      el("p", { class: "card-note", text: "Gesamtausgaben = Verträge + Anlagen + sonstige Ausgaben. Anlagen mindern die frei verfügbare Summe, zählen aber nicht zu den Vertragskosten." }),
      el("div", { class: "ko-sum-row ko-free" }, el("span", { text: "Frei verfügbar" }), el("span", { class: `num${sm.free < 0 ? " neg" : ""}`, text: money(sm.free) }))));

  const unconfirmed = state.suggestions.length;
  const auto = el("section", { class: "card ko-card" },
    el("label", { class: "pv-filter", for: "ko-auto" },
      el("input", { type: "checkbox", id: "ko-auto", "data-act": "auto", checked: state.auto }),
      el("span", { text: "Automatisch erkannte Verträge und Anlagen mitrechnen" })),
    el("p", { class: "card-note", text: `Bestätigte Einträge aus „Verträge“ zählen immer. ${unconfirmed ? `${unconfirmed} erkannte Vorschläge sind noch unbestätigt.` : "Es gibt keine unbestätigten Vorschläge."}` }),
    el("a", { class: "link", href: "#vertraege", text: "Verträge & Anlagen prüfen" }));

  const regularIncome = el("section", { class: "card ko-card" },
    el("h2", { class: "ko-h", text: "Regelmäßige Einnahmen" }),
    state.incomeList.length
      ? el("ul", { class: "ko-items" }, ...state.incomeList.map((entry) =>
          el("li", { class: "ko-item" },
            el("div", { class: "ko-item-main" }, el("span", { class: "ko-item-label", text: entry.name }), el("span", { class: "ko-tags", text: INTERVAL_LABELS[entry.intervalMonths] })),
            el("span", { class: "num pos", text: signed(entry.varies ? entry.avgAmount : entry.amount) }))))
      : el("p", { class: "card-note", text: "Noch keine regelmäßigen Einnahmen erkannt – dafür braucht es mindestens drei Zahlungen im gleichen Abstand." }));

  const fixed = [...state.schedule].sort((a, b) => b.amount / b.intervalMonths - a.amount / a.intervalMonths);
  const regularExpenses = el("section", { class: "card ko-card" },
    el("h2", { class: "ko-h", text: "Regelmäßige Ausgaben" }),
    fixed.length
      ? el("ul", { class: "ko-items" }, ...fixed.slice(0, 8).map((item) =>
          el("li", { class: "ko-item" },
            el("div", { class: "ko-item-main" },
              el("span", { class: "ko-item-label", text: item.name }),
              el("span", { class: "ko-tags", text: `${item.kind === "investment" ? "Anlage" : "Vertrag"} · ${INTERVAL_LABELS[item.intervalMonths]}${item.source === "detected" ? " · automatisch erkannt" : ""}` })),
            el("span", { class: "num", text: `${signed(-Math.round(item.amount / item.intervalMonths))}/Monat` }))),
          fixed.length > 8 ? el("li", { class: "ko-item" }, el("span", { class: "card-note", text: `… und ${fixed.length - 8} weitere` })) : null)
      : el("p", { class: "card-note", text: "Noch keine regelmäßigen Ausgaben erkannt oder bestätigt." }));

  body.replaceChildren(monthNav(), el("div", { class: "ko-grid" },
    el("div", { class: "ko-col" }, hero, breakdown),
    el("div", { class: "ko-col" }, auto, regularIncome, regularExpenses)));
}

/* ---------- Ereignisse ---------- */

function onClick(event) {
  const act = event.target.closest("[data-act]")?.dataset.act;
  const index = state.months.indexOf(state.ym);
  if (act === "prev" && index > 0) state.ym = state.months[index - 1];
  else if (act === "next" && index < state.months.length - 1) state.ym = state.months[index + 1];
  else return;
  render();
}

function onChange(event) {
  const target = event.target;
  if (target.dataset?.act === "month") { state.ym = target.value; render(); }
  else if (target.dataset?.act === "auto") {
    state.auto = target.checked;
    try { localStorage.setItem(AUTO_KEY, state.auto ? "1" : "0"); } catch { /* optional */ }
    recompute();
    render();
  }
}

export function initKonto() {
  body = document.getElementById("ko-body");
  if (!body) return;
  try { state.auto = localStorage.getItem(AUTO_KEY) !== "0"; } catch { /* Standard: an */ }
  body.addEventListener("click", onClick);
  body.addEventListener("change", onChange);
  const onNavigate = () => { if (location.hash === "#konto") refresh(); };
  window.addEventListener("hashchange", onNavigate);
  onNavigate();
}
export { state, recompute, summaryFor };
