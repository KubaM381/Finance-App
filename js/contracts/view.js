// Oberfläche „Verträge“: Vorschläge prüfen, Verträge/Anlagen verwalten, Kosten pro Monat und Jahr.
// Alles lokal (IndexedDB), keine Netzwerkzugriffe.
import { listTransactions, formatMoney, formatDate, formatAmountInput, parseAmount, parseDate } from "../transactions/transactions.js";
import {
  INTERVALS, INTERVAL_LABELS, detectSuggestions, describeContract, createContract, createIgnored,
  listContracts, saveContract, removeContract, totals, todayIso, addMonths
} from "./contracts.js";

const TABS = [["contract", "Verträge"], ["investment", "Anlagen"], ["suggestions", "Vorschläge"]];
const state = { tab: "contract", records: [], views: [], suggestions: [], hasTransactions: false, editing: null, notice: "", confirmDelete: false };
let ui = {};

const PROPS = new Set(["value", "checked", "disabled", "hidden", "textContent"]);
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (PROPS.has(key)) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child != null && child !== false));
  return node;
}

const money = (cents) => formatMoney(cents);
const confidenceLabel = (c) => (c >= 0.85 ? "Hohe Sicherheit" : c >= 0.65 ? "Mittlere Sicherheit" : "Geringe Sicherheit");
const kindLabel = (kind) => (kind === "investment" ? "Anlage" : "Vertrag");

/* ---------- Daten ---------- */

async function refresh() {
  try {
    const [transactions, records] = await Promise.all([listTransactions(), listContracts()]);
    const today = todayIso();
    state.hasTransactions = transactions.length > 0;
    state.records = records;
    state.views = records.filter((r) => r.status === "active").map((r) => describeContract(r, transactions, { today }));
    state.suggestions = detectSuggestions(transactions, records, { today });
    render();
  } catch (error) {
    ui.body.replaceChildren(el("div", { class: "notice error", text: `Verträge konnten nicht geladen werden: ${error?.message || error}` }));
  }
}

async function persist(action, message) {
  try {
    await action();
    state.notice = message;
    state.editing = null;
    state.confirmDelete = false;
    await refresh();
  } catch (error) {
    state.notice = `Speichern fehlgeschlagen: ${error?.message || error}`;
    render();
  }
}

/* ---------- Darstellung ---------- */

function render() {
  const sums = totals(state.views);
  ui.summary.replaceChildren(
    summaryCard("Vertragskosten pro Monat", sums.contractMonthly, `${money(sums.contractYearly)} pro Jahr · ${sums.contractCount} ${sums.contractCount === 1 ? "Vertrag" : "Verträge"}`, "out"),
    summaryCard("Anlagen pro Monat", sums.investmentMonthly, `${money(sums.investmentYearly)} pro Jahr · ${sums.investmentCount} ${sums.investmentCount === 1 ? "Anlage" : "Anlagen"}`, "in")
  );

  const counts = { contract: sums.contractCount, investment: sums.investmentCount, suggestions: state.suggestions.length };
  ui.tabs.replaceChildren(...TABS.map(([id, label]) =>
    el("button", { type: "button", role: "tab", class: "seg-btn", "data-tab": id, "aria-selected": String(state.tab === id), text: `${label} (${counts[id]})` })));

  ui.editor.hidden = !state.editing;
  if (state.editing) ui.editor.replaceChildren(buildEditor(state.editing));
  else ui.editor.replaceChildren();

  const content = [];
  if (state.notice) content.push(el("div", { class: "notice" }, el("span", { text: state.notice })));
  if (state.tab === "suggestions") content.push(...suggestionsView());
  else content.push(listView(state.tab));
  ui.body.replaceChildren(...content);
}

function summaryCard(label, monthly, note, direction) {
  return el("article", { class: "card" },
    el("p", { class: "card-label", text: label }),
    el("p", { class: "card-value num", text: money(monthly) }),
    el("p", { class: "card-note", text: note }));
}

function listView(kind) {
  const items = state.views.filter((v) => v.kind === kind).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  if (!items.length) {
    const noun = kind === "investment" ? "Anlagen" : "Verträge";
    const hint = state.suggestions.length
      ? `Es gibt ${state.suggestions.length} erkannte Vorschläge – prüfe sie im Reiter „Vorschläge“.`
      : state.hasTransactions
        ? "Es wurden noch keine regelmäßigen Zahlungen erkannt. Du kannst Einträge auch manuell hinzufügen."
        : "Importiere zuerst Kontoauszüge unter „Transaktionen“ oder füge Einträge manuell hinzu.";
    return el("div", { class: "card empty" }, el("h2", { text: `Noch keine ${noun}` }), el("p", { text: hint }));
  }
  const note = kind === "investment"
    ? "Anlagen sind regelmäßige Investments (z. B. ETF-Sparplan) und zählen nicht zu den Vertragskosten."
    : null;
  return el("div", {},
    note ? el("p", { class: "card-note ct-hint", text: note }) : null,
    el("div", { class: "card tx-card" }, el("ul", { class: "tx-list" }, ...items.map(contractRow))));
}

function contractRow(v) {
  const meta = [`${money(v.amount)} · ${INTERVAL_LABELS[v.intervalMonths]}`];
  const lines = [
    el("p", { class: "tx-name ct-name", text: v.name }),
    el("p", { class: "tx-meta", text: meta[0] }),
    el("p", { class: "tx-meta", text: `Nächste Zahlung: ${formatDate(v.nextDate)}` })
  ];
  if (v.varies) lines.push(el("p", { class: "tx-meta", text: `Ø ${money(v.avgAmount)} (schwankt zwischen ${money(v.minAmount)} und ${money(v.maxAmount)})` }));
  if (v.ended) lines.push(el("p", { class: "ct-warn", text: `Keine Zahlung seit ${formatDate(v.lastPaid)} – eventuell gekündigt?` }));
  return el("li", { class: "tx ct-item", "data-id": v.id },
    el("div", { class: "tx-main" }, ...lines),
    el("div", { class: "ct-side" },
      el("span", { class: "amount num", text: `${money(v.monthly)}/Monat` }),
      el("span", { class: "card-note num", text: `${money(v.yearly)}/Jahr` }),
      el("button", { type: "button", class: "link", "data-act": "edit", text: "Bearbeiten" })));
}

function suggestionsView() {
  const out = [
    el("p", { class: "card-note ct-hint", text: "Nicht jede regelmäßige Ausgabe ist ein Vertrag. Prüfe die Vorschläge und bestätige, bearbeite oder ignoriere sie." })
  ];
  if (!state.suggestions.length) {
    out.push(el("div", { class: "card empty" }, el("h2", { text: "Keine Vorschläge" }),
      el("p", { text: state.hasTransactions
        ? "Es wurden keine neuen regelmäßigen Ausgaben erkannt. Je mehr Monate importiert sind, desto besser die Erkennung."
        : "Importiere zuerst Kontoauszüge unter „Transaktionen“." })));
  } else {
    out.push(el("div", { class: "ct-cards" }, ...state.suggestions.map(suggestionCard)));
  }
  const ignored = state.records.filter((r) => r.status === "ignored");
  if (ignored.length) {
    out.push(el("details", { class: "card ct-ignored" },
      el("summary", { text: `Ignorierte Vorschläge (${ignored.length})` }),
      el("ul", { class: "tx-list" }, ...ignored.map((r) =>
        el("li", { class: "tx", "data-id": r.id },
          el("div", { class: "tx-main" }, el("p", { class: "tx-name", text: r.name })),
          el("button", { type: "button", class: "link", "data-act": "restore", text: "Wiederherstellen" }))))));
  }
  return out;
}

function suggestionCard(s) {
  const monthly = Math.round((s.varies ? s.avgAmount : s.amount) / s.intervalMonths);
  const yearly = Math.round(((s.varies ? s.avgAmount : s.amount) * 12) / s.intervalMonths);
  return el("article", { class: "card ct-card", "data-key": s.key },
    el("div", { class: "section-head" },
      el("h2", { class: "ct-name", text: s.name }),
      el("span", { class: "chip", text: confidenceLabel(s.confidence) })),
    el("p", { class: "tx-meta", text: `${money(s.amount)} · ${INTERVAL_LABELS[s.intervalMonths]} · ${s.count} Zahlungen, zuletzt ${formatDate(s.lastDate)}` }),
    s.varies ? el("p", { class: "tx-meta", text: `Ø ${money(s.avgAmount)} (schwankt zwischen ${money(s.minAmount)} und ${money(s.maxAmount)})` }) : null,
    el("p", { class: "tx-meta", text: `Nächste Zahlung erwartet: ${formatDate(s.nextDate)} · ≈ ${money(monthly)}/Monat · ${money(yearly)}/Jahr` }),
    el("p", { class: "tx-meta", text: `Vorschlag: ${kindLabel(s.kind)}` }),
    el("div", { class: "ct-actions" },
      el("button", { type: "button", class: "btn btn-primary", "data-act": "confirm", text: s.kind === "investment" ? "Als Anlage bestätigen" : "Als Vertrag bestätigen" }),
      el("button", { type: "button", class: "btn", "data-act": "edit-suggestion", text: "Bearbeiten" }),
      el("button", { type: "button", class: "btn", "data-act": "ignore", text: "Ignorieren" })));
}

/* ---------- Editor ---------- */

function buildEditor(editing) {
  const { draft } = editing;
  const intervalSelect = el("select", { id: "ct-interval", "data-f": "intervalMonths" },
    ...INTERVALS.map((i) => el("option", { value: String(i), text: INTERVAL_LABELS[i] })));
  intervalSelect.value = String(draft.intervalMonths);
  const kindSelect = el("select", { id: "ct-kind", "data-f": "kind" },
    el("option", { value: "contract", text: "Vertrag" }), el("option", { value: "investment", text: "Anlage / Investment" }));
  kindSelect.value = draft.kind;
  const field = (label, control, id) => el("div", { class: "field" }, el("label", { for: id, text: label }), control);

  return el("div", { class: "card ct-editor" },
    el("div", { class: "section-head" }, el("h2", { text: editing.id ? "Eintrag bearbeiten" : editing.suggestion ? "Vorschlag bearbeiten" : "Neuer Eintrag" })),
    el("div", { class: "pv-editor" },
      field("Name", el("input", { type: "text", id: "ct-name", "data-f": "name", value: draft.name, maxlength: "60", autocomplete: "off" }), "ct-name"),
      field("Art", kindSelect, "ct-kind"),
      field("Betrag pro Zahlung (€)", el("input", { type: "text", inputmode: "decimal", id: "ct-amount", "data-f": "amount", value: draft.amount, autocomplete: "off" }), "ct-amount"),
      field("Intervall", intervalSelect, "ct-interval"),
      field("Nächste Zahlung", el("input", { type: "date", id: "ct-next", "data-f": "nextDate", value: draft.nextDate }), "ct-next")),
    editing.error ? el("p", { class: "ct-warn", text: editing.error }) : null,
    el("div", { class: "ct-actions" },
      el("button", { type: "button", class: "btn btn-primary", "data-act": "save", text: "Speichern" }),
      el("button", { type: "button", class: "btn", "data-act": "cancel", text: "Abbrechen" }),
      editing.id ? el("button", { type: "button", class: "btn ct-danger", "data-act": "delete", text: state.confirmDelete ? "Wirklich löschen?" : "Löschen" }) : null));
}

function startEditing({ record = null, suggestion = null, kind = "contract" } = {}) {
  const source = record || suggestion;
  state.confirmDelete = false;
  state.notice = "";
  state.editing = {
    id: record?.id || null,
    suggestion,
    record,
    error: "",
    draft: {
      name: source?.name || "",
      kind: source?.kind || kind,
      amount: source ? formatAmountInput(source.amount) : "",
      intervalMonths: source?.intervalMonths || 1,
      nextDate: (record && state.views.find((v) => v.id === record.id)?.nextDate) || source?.nextDate || addMonths(todayIso(), 1)
    }
  };
  render();
  ui.editor.scrollIntoView?.({ block: "start" });
}

function readEditor() {
  const draft = state.editing.draft;
  const amount = parseAmount(draft.amount);
  const nextDate = parseDate(draft.nextDate);
  if (!draft.name.trim()) return { error: "Bitte einen Namen eingeben." };
  if (amount == null || amount === 0) return { error: "Bitte einen gültigen Betrag eingeben." };
  if (!nextDate) return { error: "Bitte ein gültiges Datum für die nächste Zahlung angeben." };
  return { value: { name: draft.name.trim(), kind: draft.kind, amount: Math.abs(amount), intervalMonths: Number(draft.intervalMonths), nextDate } };
}

/* ---------- Ereignisse ---------- */

function onClick(event) {
  const tab = event.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; state.notice = ""; render(); return; }

  const trigger = event.target.closest("[data-act]");
  if (!trigger) return;
  const act = trigger.dataset.act;
  const id = trigger.closest("[data-id]")?.dataset.id;
  const key = trigger.closest("[data-key]")?.dataset.key;
  const suggestion = key ? state.suggestions.find((s) => s.key === key) : null;

  if (act === "add") startEditing({ kind: state.tab === "investment" ? "investment" : "contract" });
  else if (act === "edit") startEditing({ record: state.records.find((r) => r.id === id) });
  else if (act === "edit-suggestion" && suggestion) startEditing({ suggestion });
  else if (act === "cancel") { state.editing = null; state.confirmDelete = false; render(); }
  else if (act === "confirm" && suggestion) {
    persist(() => saveContract(createContract({ ...suggestion, groupKey: suggestion.groupKey, source: "detected" })),
      `„${suggestion.name}“ wurde als ${kindLabel(suggestion.kind)} gespeichert.`);
  } else if (act === "ignore" && suggestion) {
    persist(() => saveContract(createIgnored(suggestion)), `„${suggestion.name}“ wird nicht mehr vorgeschlagen.`);
  } else if (act === "restore" && id) {
    persist(() => removeContract(id), "Der Vorschlag wurde wiederhergestellt.");
  } else if (act === "save") {
    const result = readEditor();
    if (result.error) { state.editing.error = result.error; render(); return; }
    const { editing } = state;
    const base = editing.record
      ? { ...editing.record, ...result.value }
      : createContract({
          ...result.value,
          groupKey: editing.suggestion?.groupKey ?? null,
          bucket: editing.suggestion?.bucket ?? null,
          source: editing.suggestion ? "detected" : "manual"
        });
    state.tab = result.value.kind;
    persist(() => saveContract(base), `„${result.value.name}“ wurde gespeichert.`);
  } else if (act === "delete") {
    if (!state.confirmDelete) { state.confirmDelete = true; render(); return; }
    const record = state.editing.record;
    // Erkannte Einträge werden als „ignoriert“ gemerkt, damit sie nicht sofort wieder vorgeschlagen werden.
    persist(() => (record.groupKey
      ? saveContract({ ...record, status: "ignored" })
      : removeContract(record.id)), `„${record.name}“ wurde entfernt.`);
  }
}

function onInput(event) {
  const field = event.target.dataset?.f;
  if (!field || !state.editing) return;
  state.editing.draft[field] = event.target.value;
}

/* ---------- Start ---------- */

export function initContracts() {
  ui = {
    summary: document.getElementById("ct-summary"),
    tabs: document.getElementById("ct-tabs"),
    editor: document.getElementById("ct-editor"),
    body: document.getElementById("ct-body"),
    add: document.getElementById("ct-add")
  };
  if (Object.values(ui).some((node) => !node)) return;

  const root = ui.body.closest("section");
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);

  // Beim Öffnen des Reiters neu berechnen (neue Importe werden so automatisch berücksichtigt).
  const onNavigate = () => { if (location.hash === "#vertraege") { state.notice = ""; refresh(); } };
  window.addEventListener("hashchange", onNavigate);
  onNavigate();
}
