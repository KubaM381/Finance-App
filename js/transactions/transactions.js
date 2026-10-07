// Einheitliches internes Transaktionsformat, Parser-Helfer, Validierung und Duplikaterkennung.
//
// Gespeicherter Datensatz:
//   { id, accountId, date: "YYYY-MM-DD", amount: Cent (vorzeichenbehaftet), type: "income"|"expense",
//     payee, purpose, category, currency, key (Duplikat-Schlüssel), batchId, source: "csv"|"pdf", importedAt }
import { getAll, putBatch, deleteByIndex, deleteRecord, newId } from "../db/database.js";
import { categorize, normalizeText } from "./categories.js";
import { ruleCategory } from "./rules.js";
import { findTransfers, isTransfer } from "./transfers.js";

export { normalizeText, findTransfers, isTransfer };

export class ImportError extends Error {}

/* ---------- Datum & Betrag ---------- */

const pad = (n) => String(n).padStart(2, "0");

function toIso(year, month, day) {
  if (!(year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Unterstützt 31.12.2025, 31.12.25, 2025-12-31, 31/12/2025 sowie (mit ctx.yearFor/ctx.year) 31.12.
export function parseDate(input, ctx = {}) {
  const s = String(input ?? "").trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/, "");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (m) return toIso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})$/);
  if (m) {
    let day = +m[1], month = +m[2], year = +m[3];
    if (m[3].length === 2) year += 2000;
    if (s.includes("/") && month > 12 && day <= 12) [day, month] = [month, day];
    return toIso(year, month, day);
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (m && (ctx.yearFor || ctx.year)) return toIso(ctx.yearFor ? ctx.yearFor(+m[2]) : ctx.year, +m[2], +m[1]);
  return null;
}

// Gibt Cent (ganze Zahl, vorzeichenbehaftet) oder null zurück.
// Versteht 1.234,56 · 1,234.56 · -12,50 · 12,50- · (12,50) · 12,50 S/H · 12,50 EUR
export function parseAmount(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  let sign = 1;
  s = s.replace(/[−–—]/g, "-");
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  s = s.replace(/\b(EUR|USD|CHF|GBP)\b/gi, "").replace(/[€$£]/g, "").replace(/[\s\u00a0\u202f']/g, "");
  const sh = s.match(/^(.*\d)([SH])$/i);
  if (sh) { sign = sh[2].toUpperCase() === "S" ? -1 : 1; s = sh[1]; }
  if (s.endsWith("-")) { sign = -1; s = s.slice(0, -1); } else if (s.endsWith("+")) s = s.slice(0, -1);
  if (s.startsWith("-")) { sign = -1; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return null;

  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  const pos = Math.max(lastDot, lastComma);
  let intPart = s, decPart = "";
  if (pos !== -1) {
    const sep = s[pos];
    const after = s.length - pos - 1;
    const both = lastDot !== -1 && lastComma !== -1;
    const repeated = s.split(sep).length > 2;
    if (both) {
      if (after < 1 || after > 2) return null;
      intPart = s.slice(0, pos); decPart = s.slice(pos + 1);
    } else if (repeated || after === 3) {
      if (after !== 3) return null; // Tausendertrennzeichen
    } else if (after >= 1 && after <= 2) {
      intPart = s.slice(0, pos); decPart = s.slice(pos + 1);
    } else return null;
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d+$/.test(intPart || "0") || (decPart && !/^\d+$/.test(decPart))) return null;
  const cents = Number(intPart || "0") * 100 + Number((decPart + "00").slice(0, 2));
  return sign * cents;
}

export const formatDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");

const formatters = new Map();
export function formatMoney(cents, currency = "EUR", { sign = false } = {}) {
  const key = `${currency}|${sign}`;
  if (!formatters.has(key)) {
    const options = { style: "currency", currency, signDisplay: sign ? "exceptZero" : "auto" };
    try { formatters.set(key, new Intl.NumberFormat("de-DE", options)); }
    catch { formatters.set(key, new Intl.NumberFormat("de-DE", { ...options, currency: "EUR" })); }
  }
  return formatters.get(key).format(cents / 100);
}

export function formatAmountInput(cents) {
  if (cents == null) return "";
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)},${pad(abs % 100)}`;
}

/* ---------- Sortierung ---------- */

// Neueste zuerst; bei gleichem Datum der zuletzt importierte Eintrag zuerst.
export const compareByDateDesc = (a, b) =>
  b.date.localeCompare(a.date) || (b.importedAt || "").localeCompare(a.importedAt || "");

/* ---------- Entwürfe (Vorschau vor dem Import) ---------- */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
let draftCounter = 0;

// notes: [{ text, field }] – Hinweise des Parsers, die verschwinden, sobald der Nutzer das Feld korrigiert.
export function makeDraft(fields) {
  const draft = {
    uid: `d${++draftCounter}`,
    date: fields.date ?? null,
    amount: fields.amount ?? null,
    payee: clean(fields.payee),
    purpose: clean(fields.purpose),
    category: "",
    categoryAuto: true,
    currency: fields.currency || "EUR",
    raw: clean(fields.raw),
    notes: fields.notes ? [...fields.notes] : [],
    duplicate: false,
    include: true,
    userToggled: false
  };
  validateDraft(draft);
  applyDefaultInclude(draft);
  return draft;
}

export function validateDraft(d) {
  const issues = [];
  if (!d.date) issues.push({ level: "error", text: "Datum fehlt oder ist ungültig" });
  if (d.amount == null) issues.push({ level: "error", text: "Betrag fehlt oder ist ungültig" });
  else if (d.amount === 0) issues.push({ level: "warn", text: "Betrag ist 0" });
  if (!d.payee && !d.purpose) issues.push({ level: "warn", text: "Kein Empfänger oder Verwendungszweck erkannt" });
  d.notes.forEach((note) => issues.push({ level: "warn", text: note.text }));
  d.issues = issues;
  d.status = issues.some((i) => i.level === "error") ? "error" : issues.length ? "warn" : "ok";
  d.type = d.amount == null ? null : d.amount >= 0 ? "income" : "expense";
  if (d.categoryAuto) d.category = ruleCategory(d.payee, d.purpose, d.type) || categorize(`${d.payee} ${d.purpose}`, d.type);
  return d;
}

export function applyDefaultInclude(d) {
  if (!d.userToggled) d.include = !d.duplicate && d.status !== "error";
}

/* ---------- Duplikate ---------- */

// Gleiche Konto/Datum/Betrag/Text-Kombination. Mehrfache identische Buchungen am selben Tag
// (z. B. zwei Kaffee) werden gezählt: Nur so viele Zeilen gelten als Duplikat, wie schon gespeichert sind.
export const dedupeKey = (accountId, d) =>
  `${accountId}|${d.date}|${d.amount}|${normalizeText(`${d.payee} ${d.purpose}`).replace(/ /g, "").slice(0, 48)}`;

export function markDuplicates(drafts, existing, accountId) {
  const stored = new Map();
  for (const t of existing) stored.set(t.key, (stored.get(t.key) || 0) + 1);
  const seen = new Map();
  for (const d of drafts) {
    d.duplicate = false;
    if (!d.date || d.amount == null) continue;
    const key = dedupeKey(accountId, d);
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    d.duplicate = (stored.get(key) || 0) >= n;
  }
}

/* ---------- Speichern ---------- */

export const toRecord = (d, accountId, batchId, source, importedAt) => ({
  id: newId(),
  accountId,
  date: d.date,
  amount: d.amount,
  type: d.amount >= 0 ? "income" : "expense",
  payee: d.payee,
  purpose: d.purpose,
  category: d.category,
  currency: d.currency,
  key: dedupeKey(accountId, d),
  batchId,
  source,
  importedAt
});

// Alle gespeicherten Buchungen (inkl. Umbuchungen) – für Import, Duplikatprüfung, Kontostände und die Liste.
export const listAllTransactions = () => getAll("transactions");

// Buchungen ohne Umbuchungen zwischen eigenen Konten – Grundlage für Einnahmen, Ausgaben, Verträge, Statistiken.
export async function listTransactions() {
  const all = await listAllTransactions();
  const auto = findTransfers(all);
  return all.filter((t) => !isTransfer(t, auto));
}

export const saveImport = ({ accounts = [], transactions }) => putBatch({ accounts, transactions });

export async function undoImport(batchId, newAccountId) {
  await deleteByIndex("transactions", "batchId", batchId);
  if (newAccountId) await deleteRecord("accounts", newAccountId);
}
