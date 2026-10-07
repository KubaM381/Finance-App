// Reiter „Übersicht“: Gesamtsumme aller Konten, Kennzahlen des letzten Monats, Prognose bis Monatsende,
// anstehende Zahlungen (30 Tage), Kündigungsfristen, Budget-Warnungen und neueste Transaktionen.
// Alles live aus IndexedDB, keine Beispieldaten.
import { listTransactions, listAllTransactions, formatMoney, formatDate, compareByDateDesc } from "../transactions/transactions.js";
import { listAccounts, maskIban } from "../accounts/accounts.js";
import { accountBalance, totalBalance, hasBalance } from "../accounts/balances.js";
import { listContracts, describeContract, detectRecurringIncome, addMonths, todayIso } from "../contracts/contracts.js";
import { cancelBy, daysUntil } from "../contracts/insights.js";
import { listBudgets, budgetStatus, listGoals, goalInfo, bar } from "../planning/planning.js";
import { el, icon } from "../contracts/view.js";

let body = null;

const monthLabel = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function statCard(label, value, note, iconId, kind) {
  return el("article", { class: "card" },
    el("div", { class: "stat-head" }, el("span", { class: `stat-icon ${kind}` }, icon(iconId)), el("p", { class: "card-label", text: label })),
    el("p", { class: "card-value num", text: value }), el("p", { class: "card-note", text: note }));
}

// Alle Termine einer Reihe (nextDate + k·Intervall) bis einschließlich `to`.
function occurrences(nextDate, interval, to) {
  const dates = [];
  for (let d = nextDate; d <= to && dates.length < 40; d = addMonths(d, interval)) dates.push(d);
  return dates;
}

function listCard(title, rows) {
  return el("article", { class: "card ko-card ov-wide" }, el("h2", { class: "ko-h", text: title }),
    el("ul", { class: "ko-items" }, ...rows.map((r) => el("li", { class: "ko-item" },
      el("div", { class: "ko-item-main" }, el("span", { class: "ko-item-label", text: r.label }), el("span", { class: r.warn ? "ct-warn" : "ko-tags", text: r.meta })),
      r.value ? el("span", { class: `num${r.pos ? " pos" : ""}`, text: r.value }) : null))));
}

async function render() {
  const [all, real, accounts, records, budgets, goals] = await Promise.all([listAllTransactions(), listTransactions(), listAccounts(), listContracts(), listBudgets(), listGoals()]);
  if (!all.length) {
    body.replaceChildren(el("div", { class: "card empty" }, el("h2", { text: "Noch keine Daten" }),
      el("p", { text: "Importiere einen Kontoauszug unter „Transaktionen“, dann erscheint hier deine Übersicht." }),
      el("a", { class: "btn btn-primary", href: "#transaktionen", text: "Zum Import" })));
    return;
  }

  const today = todayIso();
  const cards = [];

  // 1. Gesamtsumme aller Konten
  const { total, missing } = totalBalance(accounts, all);
  cards.push(el("article", { class: `hero ko-hero${total < 0 ? " neg" : ""}` },
    el("p", { class: "card-label", text: "Gesamtsumme aller Konten" }),
    el("p", { class: "hero-value num", text: formatMoney(total) }),
    el("p", { class: "hero-delta num", text: plural(accounts.length, "Konto", "Konten") }),
    missing ? el("p", { class: "ko-hero-note", text: `Für ${plural(missing, "Konto", "Konten")} wurde noch kein Kontostand gelesen – bis dahin zählen nur importierte Buchungen. Beim Import eines Auszugs kannst du ihn eintragen.` }) : null));

  // 1b. Sparziele (direkt unter der Gesamtsumme)
  cards.push(goals.length
    ? el("article", { class: "card ko-card ov-wide" },
        el("div", { class: "section-head" }, el("h2", { class: "ko-h", text: "Sparziele" }), el("a", { class: "link", href: "#statistiken", text: "Verwalten" })),
        el("ul", { class: "ko-items pl-list" }, ...goals.map((g) => {
          const { ratio, note } = goalInfo(g, today);
          return el("li", { class: "pl-item" },
            el("div", { class: "pl-head" }, el("span", { class: "ko-item-label", text: g.name }), el("span", { class: "num", text: `${formatMoney(g.saved)} von ${formatMoney(g.target)}` })),
            bar(Math.min(1, ratio), ratio >= 1 ? "ok" : "goal"),
            el("span", { class: "card-note", text: `${Math.min(100, Math.round(ratio * 100))} % · ${note}` }));
        })))
    : el("article", { class: "card ov-wide" },
        el("p", { class: "card-label", text: "Sparziele" }),
        el("p", { class: "card-note", text: "Noch kein Sparziel angelegt – mit Betrag und Datum rechnet die App den monatlichen Bedarf aus." }),
        el("a", { class: "link", href: "#statistiken", text: "Sparziel anlegen" })));

  // 2. Kennzahlen des neuesten Monats (ohne Umbuchungen) und Budget-Warnungen
  const sorted = [...real].sort(compareByDateDesc);
  if (sorted.length) {
    const ym = sorted[0].date.slice(0, 7);
    let income = 0, expenses = 0;
    for (const t of real) { if (!t.date.startsWith(ym)) continue; if (t.amount > 0) income += t.amount; else expenses -= t.amount; }
    const rate = income > 0 ? Math.max(0, Math.min(100, Math.round(((income - expenses) / income) * 100))) : 0;
    const meter = el("span"); meter.style.width = `${rate}%`;
    cards.push(
      statCard("Einnahmen", formatMoney(income), monthLabel(ym), "i-down", "in"),
      statCard("Ausgaben", formatMoney(expenses), monthLabel(ym), "i-up", "out"),
      el("article", { class: "card" }, el("p", { class: "card-label", text: "Sparquote" }), el("p", { class: "card-value num", text: `${rate} %` }),
        el("div", { class: "meter", role: "img", "aria-label": `Sparquote ${rate} Prozent` }, meter)));

    const alerts = budgetStatus(budgets, real, ym).filter((b) => b.ratio >= 0.8);
    if (alerts.length) {
      cards.push(listCard(`Budgets (${monthLabel(ym)})`, alerts.map((b) => ({
        label: b.category, warn: true, value: `${formatMoney(b.spent)} / ${formatMoney(b.limit)}`,
        meta: b.ratio >= 1 ? "Limit überschritten" : `${Math.round(b.ratio * 100)} % verbraucht`
      }))));
    }
  }

  // 3. Prognose bis Monatsende und anstehende Zahlungen (30 Tage)
  const views = records.filter((r) => r.status === "active").map((r) => describeContract(r, real, { today })).filter((v) => !v.ended);
  const monthEnd = `${today.slice(0, 7)}-31`;
  const limit = new Date(`${today}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 30);
  const in30 = limit.toISOString().slice(0, 10);
  const payments = views.flatMap((v) => occurrences(v.nextDate, v.intervalMonths, in30)
    .map((date) => ({ date, name: v.name, kind: v.kind, cents: v.varies && v.avgAmount ? v.avgAmount : v.amount })));
  const incomes = detectRecurringIncome(real, { today }).flatMap((e) => occurrences(e.nextDate, e.intervalMonths, in30)
    .map((date) => ({ date, name: e.name, cents: e.varies ? e.avgAmount : e.amount })));

  if (accounts.some(hasBalance)) {
    const out = payments.filter((p) => p.date <= monthEnd).reduce((s, p) => s + p.cents, 0);
    const inc = incomes.filter((p) => p.date <= monthEnd).reduce((s, p) => s + p.cents, 0);
    const forecast = total + inc - out;
    cards.push(el("article", { class: "card ov-wide" },
      el("p", { class: "card-label", text: "Prognose bis Monatsende" }),
      el("p", { class: `card-value num${forecast < 0 ? " st-out" : ""}`, text: formatMoney(forecast) }),
      el("p", { class: "card-note", text: `${formatMoney(total)} Kontostand + ${formatMoney(inc)} erwartete Einnahmen − ${formatMoney(out)} fällige Verträge/Anlagen. Ohne sonstige Ausgaben.` }),
      forecast < 0 ? el("p", { class: "ct-warn", text: "Achtung: Das Geld reicht voraussichtlich nicht bis zum Monatsende." }) : null));
  }

  const upcoming = [...payments.map((p) => ({ ...p, out: true })), ...incomes.map((p) => ({ ...p, out: false }))].sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length) {
    cards.push(listCard("Anstehende Zahlungen (30 Tage)", upcoming.slice(0, 10).map((p) => ({
      label: p.name, meta: `${formatDate(p.date)}${p.out ? ` · ${p.kind === "investment" ? "Anlage" : "Vertrag"}` : " · Einnahme"}`,
      value: formatMoney(p.out ? -p.cents : p.cents, "EUR", { sign: true }), pos: !p.out
    }))));
  }

  // 4. Kündigungsfristen in den nächsten 30 Tagen
  const deadlines = views.map((v) => ({ v, by: cancelBy(v) }))
    .filter((x) => x.by && daysUntil(x.by, today) >= 0 && daysUntil(x.by, today) <= 30)
    .sort((a, b) => a.by.localeCompare(b.by));
  if (deadlines.length) {
    cards.push(listCard("Kündigungsfristen", deadlines.map(({ v, by }) => {
      const days = daysUntil(by, today);
      return { label: v.name, warn: true, meta: `Kündigen bis ${formatDate(by)} (${days === 0 ? "heute" : `in ${plural(days, "Tag", "Tagen")}`})`, value: "" };
    })));
  }

  // 5. Konten einzeln (bei mehreren)
  if (accounts.length > 1) {
    cards.push(listCard("Konten", accounts.map((a) => ({ label: a.name, meta: a.iban ? maskIban(a.iban) : "", value: formatMoney(accountBalance(a, all)) }))));
  }

  // 6. Neueste Transaktionen
  cards.push(el("article", { class: "card tx-card" },
    el("div", { class: "section-head" }, el("h2", { text: "Letzte Transaktionen" }), el("a", { class: "link", href: "#transaktionen", text: "Alle anzeigen" })),
    el("ul", { class: "tx-list" }, ...[...all].sort(compareByDateDesc).slice(0, 5).map((t) =>
      el("li", { class: "tx" },
        el("span", { class: "avatar", "aria-hidden": "true", text: (t.payee || t.purpose || "?").trim().charAt(0).toUpperCase() || "?" }),
        el("div", { class: "tx-main" }, el("p", { class: "tx-name", text: t.payee || t.purpose || "(ohne Text)" }), el("p", { class: "tx-meta", text: `${t.category} · ${formatDate(t.date)}` })),
        el("span", { class: `amount num${t.amount > 0 ? " pos" : ""}`, text: formatMoney(t.amount, t.currency, { sign: true }) }))))));

  body.replaceChildren(el("div", { class: "dash" }, ...cards));
}

async function refresh() {
  try { await render(); } catch (error) {
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
