// Import-Oberfläche: Datei wählen → lokal einlesen → Vorschau prüfen/korrigieren → speichern.
// Alle Daten bleiben im Browser (IndexedDB). Es werden keine Netzwerkanfragen mit Dateiinhalten gesendet.
import { parseCsvFile } from "./csv.js";
import { parsePdfFile } from "./pdf.js";
import {
  ImportError, formatMoney, formatDate, formatAmountInput, parseAmount, validateDraft, applyDefaultInclude,
  markDuplicates, toRecord, listTransactions, saveImport, undoImport
} from "../transactions/transactions.js";
import { CATEGORY_NAMES } from "../transactions/categories.js";
import { listAccounts, createAccount, matchAccountByIban, maskIban, suggestAccountName } from "../accounts/accounts.js";
import { newId } from "../db/database.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const NEW_ACCOUNT = "__new__";
const LIST_LIMIT = 200;

const state = {
  drafts: [], meta: null, warnings: [], fileName: "", accounts: [], existing: [],
  accountChoice: NEW_ACCOUNT, newAccountName: "", onlyIssues: false, saving: false, lastImport: null
};
let ui = {};

/* ---------- kleine DOM-Helfer (nur textContent, nie innerHTML: Dateiinhalte sind nicht vertrauenswürdig) ---------- */

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

const byUid = (uid) => state.drafts.find((d) => d.uid === uid);
const accountKey = () => (state.accountChoice === NEW_ACCOUNT ? NEW_ACCOUNT : state.accountChoice);

/* ---------- Status-Hinweis ---------- */

function showStatus(text, kind = "ok", withUndo = false) {
  ui.status.className = `notice${kind === "error" ? " error" : ""}`;
  ui.status.replaceChildren(
    el("span", { text }),
    withUndo ? el("button", { type: "button", class: "link", "data-act": "undo", text: "Rückgängig" }) : null
  );
  ui.status.hidden = false;
}
const hideStatus = () => { ui.status.hidden = true; };

/* ---------- Datei erkennen & einlesen ---------- */

async function detectKind(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (String.fromCharCode(...head).includes("%PDF-")) return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b) throw new ImportError("XLSX- und ZIP-Dateien werden noch nicht unterstützt. Bitte als CSV exportieren.");
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (!utf16 && head.includes(0)) throw new ImportError("Dieses Dateiformat wird nicht unterstützt. Bitte PDF oder CSV verwenden.");
  if (/\.pdf$/i.test(file.name)) throw new ImportError("Die Datei hat die Endung .pdf, ist aber kein gültiges PDF.");
  return "csv";
}

async function handleFile(file) {
  hideStatus();
  if (file.size > MAX_FILE_BYTES) return showStatus("Die Datei ist zu groß (maximal 25 MB).", "error");
  ui.label.classList.add("is-busy");
  showStatus("Datei wird lokal auf diesem Gerät gelesen …");
  try {
    const kind = await detectKind(file);
    const result = kind === "pdf" ? await parsePdfFile(file) : await parseCsvFile(file);
    if (!result.drafts.length) throw new ImportError("Es wurden keine Buchungen erkannt.");

    [state.accounts, state.existing] = await Promise.all([listAccounts(), listTransactions()]);
    Object.assign(state, { drafts: result.drafts, meta: result.meta, warnings: result.warnings, fileName: file.name, onlyIssues: false });

    const match = matchAccountByIban(state.accounts, result.meta.iban);
    state.accountChoice = match ? match.id : !result.meta.iban && state.accounts.length === 1 ? state.accounts[0].id : NEW_ACCOUNT;
    state.newAccountName = result.meta.accountName || suggestAccountName(result.meta.iban);

    recompute(true);
    renderPanel();
    hideStatus();
  } catch (error) {
    showStatus(error instanceof ImportError ? error.message : `Der Import ist fehlgeschlagen: ${error?.message || error}`, "error");
  } finally {
    ui.label.classList.remove("is-busy");
    ui.input.value = "";
  }
}

/* ---------- Duplikate & Standardauswahl ---------- */

function recompute(resetChoices = false) {
  markDuplicates(state.drafts, state.existing, accountKey());
  for (const d of state.drafts) {
    if (resetChoices) d.userToggled = false;
    applyDefaultInclude(d);
  }
}

/* ---------- Vorschau-Panel ---------- */

function renderPanel() {
  const { meta } = state;
  const accountSelect = el("select", { id: "pv-account", "data-act": "account", "aria-label": "Konto" });
  for (const a of state.accounts) {
    accountSelect.append(el("option", { value: a.id, text: a.name + (a.iban ? ` (${maskIban(a.iban)})` : "") }));
  }
  accountSelect.append(el("option", { value: NEW_ACCOUNT, text: "Neues Konto anlegen …" }));
  accountSelect.value = state.accountChoice;

  ui.accountName = el("input", {
    type: "text", id: "pv-account-name", "data-act": "account-name", value: state.newAccountName,
    placeholder: "Name des neuen Kontos", "aria-label": "Name des neuen Kontos", maxlength: "60", hidden: state.accountChoice !== NEW_ACCOUNT
  });
  ui.summary = el("p", { class: "card-note" });
  ui.chips = el("div", { class: "pv-chips" });
  ui.list = el("ul", { class: "tx-list pv-list" });
  ui.importBtn = el("button", { type: "button", class: "btn btn-primary", "data-act": "import" });

  const filter = el("input", { type: "checkbox", id: "pv-filter", "data-act": "filter", checked: state.onlyIssues });

  ui.panel.replaceChildren(
    el("div", { class: "card pv-card" },
      el("div", { class: "section-head" },
        el("h2", { text: "Import prüfen" }),
        el("span", { class: "chip", text: `${meta.format.toUpperCase()} · ${meta.profile}` })),
      el("p", { class: "card-note pv-file", text: state.fileName }),
      ...state.warnings.map((w) => el("p", { class: "pv-warning", text: w })),
      el("div", { class: "field" }, el("label", { for: "pv-account", text: "Konto" }), accountSelect, ui.accountName,
        meta.iban ? el("p", { class: "card-note", text: `Erkannte IBAN: ${maskIban(meta.iban)}` }) : null),
      el("div", { class: "pv-tools" },
        el("button", { type: "button", class: "btn", "data-act": "invert", text: "Vorzeichen umkehren" }),
        el("label", { class: "pv-filter", for: "pv-filter" }, filter, el("span", { text: "Nur Zeilen mit Hinweis" }))),
      el("p", { class: "card-note", text: "Positive Beträge gelten als Einnahmen, negative als Ausgaben. Bei Kreditkartenauszügen ist es oft umgekehrt – dann „Vorzeichen umkehren“." }),
      ui.summary, ui.chips),
    el("div", { class: "card tx-card pv-rows" }, ui.list),
    el("div", { class: "import-bar" },
      el("button", { type: "button", class: "btn", "data-act": "cancel", text: "Abbrechen" }), ui.importBtn)
  );
  renderRows();
  ui.panel.hidden = false;
  ui.empty.hidden = true;
  ui.listCard.hidden = true;
  ui.more.hidden = true;
  ui.panel.scrollIntoView?.({ block: "start" });
}

function renderRows() {
  ui.list.replaceChildren(...state.drafts.map(renderRow));
  updateSummary();
}

function renderRow(d) {
  const li = el("li", { class: "pv-row", "data-uid": d.uid });
  const open = d.status === "error";
  li.append(
    el("div", { class: "pv-line" },
      el("input", { type: "checkbox", class: "pv-check", "data-field": "include", "aria-label": "Zeile importieren" }),
      el("div", { class: "tx-main" },
        el("p", { class: "tx-name pv-title" }), el("p", { class: "tx-meta pv-meta" }), el("p", { class: "pv-issues" })),
      el("div", { class: "pv-side" },
        el("span", { class: "amount num pv-amount" }),
        el("button", { type: "button", class: "link pv-toggle", "data-act": "toggle", "aria-expanded": String(open), text: open ? "Schließen" : "Bearbeiten" })))
  );
  if (open) li.append(buildEditor(d));
  updateRowView(li, d);
  li.hidden = state.onlyIssues && d.status === "ok" && !d.duplicate;
  return li;
}

function buildEditor(d) {
  const category = el("select", { "data-field": "category", id: `c-${d.uid}` });
  CATEGORY_NAMES.forEach((name) => category.append(el("option", { value: name, text: name })));
  category.value = d.category;
  const field = (label, control, id) => el("div", { class: "field" }, el("label", { for: id, text: label }), control);
  return el("div", { class: "pv-editor" },
    field("Datum", el("input", { type: "date", id: `d-${d.uid}`, "data-field": "date", value: d.date || "" }), `d-${d.uid}`),
    field("Betrag (− = Ausgabe)", el("input", { type: "text", inputmode: "decimal", id: `a-${d.uid}`, "data-field": "amount", value: formatAmountInput(d.amount), autocomplete: "off" }), `a-${d.uid}`),
    field("Empfänger / Auftraggeber", el("input", { type: "text", id: `p-${d.uid}`, "data-field": "payee", value: d.payee, autocomplete: "off" }), `p-${d.uid}`),
    field("Verwendungszweck", el("textarea", { id: `u-${d.uid}`, "data-field": "purpose", rows: "2", value: d.purpose }), `u-${d.uid}`),
    field("Kategorie", category, `c-${d.uid}`),
    d.raw ? el("p", { class: "pv-raw", text: `Originalzeile: ${d.raw}` }) : null
  );
}

function updateRowView(li, d) {
  li.classList.toggle("is-error", d.status === "error");
  li.classList.toggle("is-warn", d.status === "warn" && !d.duplicate);
  li.classList.toggle("is-dup", d.duplicate);
  const check = li.querySelector(".pv-check");
  check.checked = d.include && d.status !== "error";
  check.disabled = d.status === "error";
  li.querySelector(".pv-title").textContent = d.payee || d.purpose || d.raw || "(ohne Text)";
  const typeLabel = d.type === "income" ? "Einnahme" : d.type === "expense" ? "Ausgabe" : "–";
  li.querySelector(".pv-meta").textContent = `${d.date ? formatDate(d.date) : "Datum fehlt"} · ${typeLabel} · ${d.category}`;
  const notes = d.issues.map((i) => i.text);
  if (d.duplicate) notes.unshift("Bereits vorhanden – wird übersprungen");
  const issues = li.querySelector(".pv-issues");
  issues.textContent = notes.join(" · ");
  issues.hidden = notes.length === 0;
  const amount = li.querySelector(".pv-amount");
  amount.textContent = d.amount == null ? "?" : formatMoney(d.amount, d.currency, { sign: true });
  amount.classList.toggle("pos", d.type === "income");
  const category = li.querySelector('[data-field="category"]');
  if (category && category.value !== d.category) category.value = d.category;
}

function updateSummary() {
  const chosen = state.drafts.filter((d) => d.include && d.status !== "error");
  const sum = (test) => chosen.filter(test).reduce((total, d) => total + d.amount, 0);
  const currency = state.meta.currency;
  ui.summary.textContent = `${chosen.length} von ${state.drafts.length} Zeilen ausgewählt · Einnahmen ${formatMoney(sum((d) => d.amount > 0), currency)} · Ausgaben ${formatMoney(Math.abs(sum((d) => d.amount < 0)), currency)}`;
  const review = state.drafts.filter((d) => d.status !== "ok").length;
  const dups = state.drafts.filter((d) => d.duplicate).length;
  ui.chips.replaceChildren(
    ...[review && `${review} zu prüfen`, dups && `${dups} bereits vorhanden`].filter(Boolean).map((text) => el("span", { class: "chip", text }))
  );
  ui.importBtn.textContent = chosen.length === 1 ? "1 Transaktion importieren" : `${chosen.length} Transaktionen importieren`;
  ui.importBtn.disabled = chosen.length === 0 || state.saving;
}

function refreshRows(onlyUids = null) {
  for (const li of ui.list.children) {
    const d = byUid(li.dataset.uid);
    if (!onlyUids || onlyUids.has(d.uid)) {
      updateRowView(li, d);
      li.hidden = state.onlyIssues && d.status === "ok" && !d.duplicate;
    }
  }
  updateSummary();
}

/* ---------- Ereignisse ---------- */

function onField(event) {
  const target = event.target;
  const field = target.dataset?.field;
  const li = target.closest?.(".pv-row");
  if (!field || !li) return;
  const d = byUid(li.dataset.uid);
  const dropNotes = (name) => { d.notes = d.notes.filter((n) => n.field !== name); };

  if (field === "include") {
    if (event.type !== "change") return;
    d.include = target.checked;
    d.userToggled = true;
  } else if (field === "date") {
    d.date = target.value || null;
    dropNotes("date");
  } else if (field === "amount") {
    const text = target.value.trim();
    d.amount = text ? parseAmount(text) : null;
    dropNotes("amount");
    if (event.type === "change" && d.amount != null) target.value = formatAmountInput(d.amount);
  } else if (field === "payee" || field === "purpose") {
    d[field] = target.value;
  } else if (field === "category") {
    d.category = target.value;
    d.categoryAuto = false;
  }

  const before = new Map(state.drafts.map((x) => [x.uid, `${x.duplicate}|${x.include}`]));
  validateDraft(d);
  markDuplicates(state.drafts, state.existing, accountKey());
  const changed = new Set([d.uid]);
  for (const x of state.drafts) {
    applyDefaultInclude(x);
    if (before.get(x.uid) !== `${x.duplicate}|${x.include}`) changed.add(x.uid);
  }
  refreshRows(changed);
}

function onAction(event) {
  const trigger = event.target.closest?.("[data-act]");
  if (!trigger) return;
  const act = trigger.dataset.act;

  if (act === "toggle") {
    const li = trigger.closest(".pv-row");
    const d = byUid(li.dataset.uid);
    let editor = li.querySelector(".pv-editor");
    if (!editor) { editor = buildEditor(d); li.append(editor); editor.hidden = true; }
    editor.hidden = !editor.hidden;
    trigger.textContent = editor.hidden ? "Bearbeiten" : "Schließen";
    trigger.setAttribute("aria-expanded", String(!editor.hidden));
  } else if (act === "invert") {
    for (const d of state.drafts) {
      if (d.amount != null) d.amount = -d.amount;
      validateDraft(d);
    }
    recompute();
    renderRows();
  } else if (act === "cancel") {
    closePanel();
  } else if (act === "import") {
    runImport();
  } else if (act === "undo") {
    runUndo();
  }
}

function onPanelChange(event) {
  const act = event.target.dataset?.act;
  if (act === "account") {
    state.accountChoice = event.target.value;
    ui.accountName.hidden = state.accountChoice !== NEW_ACCOUNT;
    recompute(true);
    refreshRows();
  } else if (act === "account-name") {
    state.newAccountName = event.target.value;
  } else if (act === "filter") {
    state.onlyIssues = event.target.checked;
    refreshRows();
  } else onField(event);
}

/* ---------- Speichern / Rückgängig ---------- */

async function runImport() {
  const selected = state.drafts.filter((d) => d.include && d.status !== "error" && d.date && d.amount != null);
  if (!selected.length || state.saving) return;
  state.saving = true;
  updateSummary();
  try {
    let newAccount = null;
    let accountId = state.accountChoice;
    if (accountId === NEW_ACCOUNT) {
      newAccount = createAccount({ name: state.newAccountName || suggestAccountName(state.meta.iban), iban: state.meta.iban, currency: state.meta.currency });
      accountId = newAccount.id;
    }
    const batchId = newId();
    const importedAt = new Date().toISOString();
    const records = selected.map((d) => toRecord(d, accountId, batchId, state.meta.format, importedAt));
    await saveImport({ accounts: newAccount ? [newAccount] : [], transactions: records });
    navigator.storage?.persist?.().catch(() => {});

    const skipped = state.drafts.length - records.length;
    state.lastImport = { batchId, newAccountId: newAccount?.id || null };
    closePanel();
    await refreshList();
    showStatus(`${records.length} Transaktionen importiert${skipped ? `, ${skipped} übersprungen` : ""}.`, "ok", true);
  } catch (error) {
    showStatus(`Speichern fehlgeschlagen: ${error?.message || error}`, "error");
  } finally {
    state.saving = false;
  }
}

async function runUndo() {
  if (!state.lastImport) return;
  try {
    await undoImport(state.lastImport.batchId, state.lastImport.newAccountId);
    state.lastImport = null;
    await refreshList();
    showStatus("Der letzte Import wurde rückgängig gemacht.");
  } catch (error) {
    showStatus(`Rückgängig machen fehlgeschlagen: ${error?.message || error}`, "error");
  }
}

function closePanel() {
  Object.assign(state, { drafts: [], meta: null, warnings: [], existing: [] });
  ui.panel.hidden = true;
  ui.panel.replaceChildren();
  refreshList().catch(() => {});
}

/* ---------- Gespeicherte Transaktionen ---------- */

async function refreshList() {
  const [transactions, accounts] = await Promise.all([listTransactions(), listAccounts()]);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  transactions.sort((a, b) => b.date.localeCompare(a.date) || b.importedAt.localeCompare(a.importedAt));
  const hasData = transactions.length > 0;
  ui.empty.hidden = hasData || !ui.panel.hidden;
  ui.listCard.hidden = !hasData || !ui.panel.hidden;
  ui.txList.replaceChildren(...transactions.slice(0, LIST_LIMIT).map((t) => {
    const meta = [t.category, formatDate(t.date), accounts.length > 1 ? names.get(t.accountId) : null].filter(Boolean).join(" · ");
    return el("li", { class: "tx" },
      el("span", { class: "avatar", "aria-hidden": "true", text: (t.payee || t.purpose || "?").trim().charAt(0).toUpperCase() || "?" }),
      el("div", { class: "tx-main" }, el("p", { class: "tx-name", text: t.payee || t.purpose || "(ohne Text)" }), el("p", { class: "tx-meta", text: meta })),
      el("span", { class: `amount num${t.amount > 0 ? " pos" : ""}`, text: formatMoney(t.amount, t.currency, { sign: true }) }));
  }));
  ui.more.hidden = transactions.length <= LIST_LIMIT || !ui.panel.hidden;
  ui.more.textContent = `Es werden die neuesten ${LIST_LIMIT} von ${transactions.length} Transaktionen angezeigt.`;
}

/* ---------- Start ---------- */

export function initImport() {
  ui = {
    input: document.getElementById("import-file"),
    label: document.getElementById("import-label"),
    status: document.getElementById("import-status"),
    panel: document.getElementById("import-panel"),
    empty: document.getElementById("tx-empty"),
    listCard: document.getElementById("tx-list-card"),
    txList: document.getElementById("tx-list"),
    more: document.getElementById("tx-more")
  };
  if (Object.values(ui).some((node) => !node)) return;

  ui.input.addEventListener("change", () => ui.input.files?.[0] && handleFile(ui.input.files[0]));
  ui.panel.addEventListener("click", onAction);
  ui.panel.addEventListener("change", onPanelChange);
  ui.panel.addEventListener("input", (event) => { if (event.target.dataset?.act === "account-name") onPanelChange(event); else onField(event); });
  ui.status.addEventListener("click", onAction);

  refreshList().catch((error) => showStatus(`Lokale Datenbank nicht verfügbar: ${error?.message || error}`, "error"));
}
