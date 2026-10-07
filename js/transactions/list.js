// Liste der gespeicherten Transaktionen: Suche, Filter, Kategorie ändern (inkl. Regel für ähnliche Buchungen)
// und Umbuchungen zwischen eigenen Konten markieren. Sortiert nach Datum (neueste zuerst).
import {
  listAllTransactions, findTransfers, isTransfer, formatMoney, formatDate, compareByDateDesc, normalizeText
} from "./transactions.js";
import { partnerOf } from "./transfers.js";
import { FALLBACK, isFallbackCategory, categoriesFor } from "./categories.js";
import { saveRule, ruleKey, rebuildLearned } from "./rules.js";
import { listAccounts } from "../accounts/accounts.js";
import { putBatch } from "../db/database.js";
import { el } from "../contracts/view.js";

const LIST_LIMIT = 200;
const filters = { q: "", month: "", category: "", type: "", account: "" };
let data = { all: [], accounts: [], auto: new Set() };
let ctx = null;
let tools = null, summary = null, cleanup = null, selects = {};
let cleanupOpen = false;
let editing = null;

const monthLabel = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

function matches(t) {
  if (filters.month && !t.date.startsWith(filters.month)) return false;
  if (filters.category && t.category !== filters.category) return false;
  if (filters.account && t.accountId !== filters.account) return false;
  const transfer = isTransfer(t, data.auto);
  if (filters.type === "income" && (t.amount <= 0 || transfer)) return false;
  if (filters.type === "expense" && (t.amount >= 0 || transfer)) return false;
  if (filters.type === "transfer" && !transfer) return false;
  if (filters.q) {
    const hay = normalizeText(`${t.payee} ${t.purpose} ${t.category} ${(Math.abs(t.amount) / 100).toFixed(2).replace(".", ",")}`);
    if (!filters.q.split(" ").every((word) => hay.includes(word))) return false;
  }
  return true;
}

/* ---------- Werkzeugleiste ---------- */

function buildTools() {
  tools = document.getElementById("tx-tools");
  if (!tools || tools.dataset.ready) return;
  tools.dataset.ready = "1";
  const search = el("input", { type: "search", id: "tx-q", placeholder: "Suchen (Empfänger, Zweck, Betrag …)", "aria-label": "Suchen", autocomplete: "off" });
  search.addEventListener("input", () => { filters.q = normalizeText(search.value); render(); });
  const select = (key, label) => {
    const node = el("select", { "aria-label": label });
    node.addEventListener("change", () => { filters[key] = node.value; render(); });
    selects[key] = node;
    return node;
  };
  summary = el("p", { class: "card-note" });
  cleanup = el("div", { class: "tx-cleanup" });
  tools.append(cleanup, search, el("div", { class: "tx-filters" }, select("month", "Monat"), select("category", "Kategorie"), select("type", "Art"), select("account", "Konto")), summary);

  ctx.ui.txList.addEventListener("click", onClick);
}

function fillTools() {
  const set = (key, options) => {
    const node = selects[key];
    node.replaceChildren(...options.map(([value, text]) => el("option", { value, text })));
    if (!options.some(([value]) => value === filters[key])) filters[key] = "";
    node.value = filters[key];
  };
  const months = [...new Set(data.all.map((t) => t.date.slice(0, 7)))].sort().reverse();
  const categories = [...new Set(data.all.map((t) => t.category))].sort((a, b) => a.localeCompare(b, "de"));
  set("month", [["", "Alle Monate"], ...months.map((m) => [m, monthLabel(m)])]);
  set("category", [["", "Alle Kategorien"], ...categories.map((c) => [c, c])]);
  set("type", [["", "Alle Arten"], ["income", "Einnahmen"], ["expense", "Ausgaben"], ["transfer", "Umbuchungen"]]);
  set("account", [["", "Alle Konten"], ...data.accounts.map((a) => [a.id, a.name])]);
  selects.account.hidden = data.accounts.length < 2;
}

/* ---------- Darstellung ---------- */

function row(t, multiAccount) {
  const transfer = isTransfer(t, data.auto);
  const account = multiAccount ? data.accounts.find((a) => a.id === t.accountId)?.name : null;
  const meta = [t.category, formatDate(t.date), account].filter(Boolean).join(" · ");
  return el("li", { class: `tx tx-click${transfer ? " is-transfer" : ""}`, "data-id": t.id, tabindex: "0", role: "button", "aria-label": "Buchung bearbeiten" },
    el("span", { class: "avatar", "aria-hidden": "true", text: (t.payee || t.purpose || "?").trim().charAt(0).toUpperCase() || "?" }),
    el("div", { class: "tx-main" },
      el("p", { class: "tx-name", text: t.payee || t.purpose || "(ohne Text)" }),
      el("p", { class: "tx-meta", text: meta }),
      transfer ? el("span", { class: "chip chip-transfer", text: "Umbuchung" }) : null),
    el("span", { class: `amount num${t.amount > 0 && !transfer ? " pos" : ""}`, text: formatMoney(t.amount, t.currency, { sign: true }) }));
}

function editor(t) {
  const type = t.amount >= 0 ? "income" : "expense";
  const options = [...new Set([...categoriesFor(type), FALLBACK[type], t.category])];
  const category = el("select", { "data-f": "category", id: "tx-cat", "aria-label": "Kategorie" },
    ...options.map((name) => el("option", { value: name, text: name })));
  category.value = t.category;
  const canRemember = Boolean(ruleKey(t.payee, t.purpose));
  const check = (field, label, checked, disabled = false) =>
    el("label", { class: "pv-filter" }, el("input", { type: "checkbox", "data-f": field, checked, disabled }), el("span", { text: label }));
  return el("li", { class: "tx-edit-row", "data-for": t.id },
    el("div", { class: "pv-editor" },
      el("div", { class: "field" }, el("label", { for: "tx-cat", text: "Kategorie" }), category),
      check("remember", "Für alle ähnlichen Buchungen merken", canRemember, !canRemember),
      check("transfer", "Umbuchung zwischen eigenen Konten (zählt nicht als Einnahme/Ausgabe)", isTransfer(t, data.auto)),
      el("div", { class: "ct-actions" },
        el("button", { type: "button", class: "btn btn-primary", "data-act": "save-tx", text: "Speichern" }),
        el("button", { type: "button", class: "btn", "data-act": "cancel-tx", text: "Abbrechen" }))));
}

function render() {
  const { ui } = ctx;
  const rows = data.all.filter(matches).sort(compareByDateDesc);
  const multi = data.accounts.length > 1;
  const items = [];
  for (const t of rows.slice(0, LIST_LIMIT)) {
    items.push(row(t, multi));
    if (editing === t.id) items.push(editor(t));
  }
  ui.txList.replaceChildren(...items);

  const real = rows.filter((t) => !isTransfer(t, data.auto));
  const income = real.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenses = real.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  summary.textContent = `${rows.length} ${rows.length === 1 ? "Buchung" : "Buchungen"} · Einnahmen ${formatMoney(income)} · Ausgaben ${formatMoney(expenses)}`;
  ui.more.hidden = rows.length <= LIST_LIMIT || ctx.panelOpen;
  ui.more.textContent = `Es werden die neuesten ${LIST_LIMIT} von ${rows.length} passenden Transaktionen angezeigt.`;
  if (!rows.length && data.all.length) ui.txList.append(el("li", { class: "tx" }, el("p", { class: "card-note", text: "Keine Buchung passt zu Suche und Filtern." })));
}

/* ---------- Aufräumen: Buchungen ohne Kategorie ---------- */

// Gruppiert alle Buchungen in "Sonstiges" nach Empfänger, damit eine Auswahl gleich viele Buchungen erledigt.
function fallbackGroups() {
  const map = new Map();
  for (const t of data.all) {
    if (!isFallbackCategory(t.category) || t.categoryManual || isTransfer(t, data.auto)) continue;
    const key = ruleKey(t.payee, t.purpose);
    if (!key) continue;
    const type = t.amount >= 0 ? "income" : "expense";
    const group = map.get(`${type}|${key}`) || { type, items: [], sum: 0, label: t.payee || t.purpose };
    group.items.push(t);
    group.sum += t.amount;
    map.set(`${type}|${key}`, group);
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length || Math.abs(b.sum) - Math.abs(a.sum));
}

async function assignGroup(group, category) {
  const sample = group.items[0];
  try {
    await saveRule(sample.payee, sample.purpose, group.type, category);
    await putBatch({ transactions: group.items.map((x) => ({ ...x, category, categoryManual: true })) });
  } catch (error) {
    summary.textContent = `Speichern fehlgeschlagen: ${error?.message || error}`;
    return;
  }
  await refreshTxList(ctx.ui, ctx.panelOpen);
}

function renderCleanup() {
  const groups = fallbackGroups();
  if (!groups.length) { cleanup.replaceChildren(); return; }
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const rows = groups.slice(0, 10).map((group) => {
    const select = el("select", { "aria-label": `Kategorie für ${group.label}` },
      el("option", { value: "", text: "Kategorie wählen …" }),
      ...categoriesFor(group.type).map((name) => el("option", { value: name, text: name })));
    select.addEventListener("change", () => select.value && assignGroup(group, select.value));
    return el("li", { class: "pl-item" },
      el("div", { class: "pl-head" }, el("span", { class: "ko-item-label", text: group.label }), el("span", { class: "num", text: formatMoney(group.sum, "EUR", { sign: true }) })),
      el("p", { class: "card-note", text: `${group.items.length} ${group.items.length === 1 ? "Buchung" : "Buchungen"}` }),
      select);
  });
  const details = el("details", { class: "card ko-card" },
    el("summary", { class: "cleanup-summary", text: `${total} ${total === 1 ? "Buchung" : "Buchungen"} ohne Kategorie – jetzt zuordnen` }),
    el("p", { class: "card-note", text: "Eine Auswahl gilt für alle Buchungen dieses Empfängers und wird für künftige Importe gemerkt." }),
    el("ul", { class: "ko-items pl-list" }, ...rows),
    groups.length > 10 ? el("p", { class: "card-note", text: `… und ${groups.length - 10} weitere Empfänger` }) : null);
  details.open = cleanupOpen;
  details.addEventListener("toggle", () => { cleanupOpen = details.open; });
  cleanup.replaceChildren(details);
}

/* ---------- Bearbeiten ---------- */

function onClick(event) {
  const act = event.target.closest("[data-act]")?.dataset.act;
  if (act === "cancel-tx") { editing = null; render(); return; }
  if (act === "save-tx") { saveEdit(event.target.closest("[data-for]").dataset.for); return; }
  if (event.target.closest(".tx-edit-row")) return;
  const id = event.target.closest(".tx-click")?.dataset.id;
  if (!id) return;
  editing = editing === id ? null : id;
  render();
}

async function saveEdit(id) {
  const t = data.all.find((x) => x.id === id);
  const box = [...ctx.ui.txList.querySelectorAll(".tx-edit-row")].find((n) => n.dataset.for === id);
  if (!t || !box) return;
  const category = box.querySelector('[data-f="category"]').value;
  const remember = box.querySelector('[data-f="remember"]').checked;
  const transfer = box.querySelector('[data-f="transfer"]').checked;
  const income = t.amount >= 0;
  const key = ruleKey(t.payee, t.purpose);

  const updates = new Map();
  const touch = (x) => { if (!updates.has(x.id)) updates.set(x.id, { ...x }); return updates.get(x.id); };
  const targets = remember && key ? data.all.filter((x) => x.amount >= 0 === income && ruleKey(x.payee, x.purpose) === key) : [t];
  for (const x of targets) {
    if (x.category !== category || !x.categoryManual) { const u = touch(x); u.category = category; u.categoryManual = true; }
  }
  if (transfer !== isTransfer(t, data.auto)) {
    touch(t).transfer = transfer;
    const partner = partnerOf(t, data.all);
    if (partner) touch(partner).transfer = transfer; // beide Seiten der Umbuchung gemeinsam
  }
  try {
    if (remember && key) await saveRule(t.payee, t.purpose, income ? "income" : "expense", category);
    if (updates.size) await putBatch({ transactions: [...updates.values()] });
  } catch (error) {
    summary.textContent = `Speichern fehlgeschlagen: ${error?.message || error}`;
    return;
  }
  editing = null;
  await refreshTxList(ctx.ui, ctx.panelOpen);
}

export async function refreshTxList(ui, panelOpen) {
  ctx = { ui, panelOpen };
  const [all, accounts] = await Promise.all([listAllTransactions(), listAccounts()]);
  data = { all, accounts, auto: findTransfers(all) };
  const hasData = all.length > 0;
  buildTools();
  ui.empty.hidden = hasData || panelOpen;
  ui.listCard.hidden = !hasData || panelOpen;
  if (tools) tools.hidden = !hasData || panelOpen;
  if (!tools) { ui.txList.replaceChildren(); return; }
  rebuildLearned(all);
  fillTools();
  renderCleanup();
  render();
}
