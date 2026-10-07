// Kategorisierung mit drei Stufen: 1) eigene Regeln, 2) Schlüsselwörter (categories.js),
// 3) gelernt aus deinen bereits kategorisierten Buchungen (gleicher Empfänger → gleiche Kategorie).
// Regeln liegen in IndexedDB (Store "rules") und werden beim Start in den Speicher geladen,
// damit die Kategorisierung beim Import synchron darauf zugreifen kann.
import { getAll, putBatch, deleteRecord, newId } from "../db/database.js";
import { normalizeText, categorize, isFallbackCategory } from "./categories.js";

const PROCESSORS = new Set(["paypal", "klarna", "stripe", "paddle", "adyen", "mollie", "sumup", "payone", "apple", "google"]);
let rules = [];
let learned = new Map();

const tokens = (text) => normalizeText(text).split(" ").filter((t) => t.length > 1 && !/\d/.test(t));
const typeOf = (amount) => (amount >= 0 ? "income" : "expense");

// Schlüssel eines Empfängers: die ersten zwei aussagekräftigen Wörter (bei Zahlungsdiensten inkl. Verwendungszweck).
export function ruleKey(payee, purpose) {
  const p = tokens(payee), u = tokens(purpose);
  if (p.length && PROCESSORS.has(p[0])) return [p[0], ...u.slice(0, 2)].join(" ");
  return (p.length ? p : u).slice(0, 2).join(" ");
}

export async function loadRules() {
  try { rules = await getAll("rules"); } catch { rules = []; }
  return rules;
}

export const listRules = () => rules;

export function ruleCategory(payee, purpose, type) {
  if (!rules.length) return null;
  const key = ruleKey(payee, purpose);
  if (!key) return null;
  return rules.find((r) => r.key === key && (!type || r.type === type))?.category || null;
}

// Häufigste (nicht-"Sonstiges") Kategorie je Empfänger aus den vorhandenen Buchungen.
export function rebuildLearned(all) {
  const votes = new Map();
  for (const t of all) {
    if (!t.category || isFallbackCategory(t.category)) continue;
    const key = ruleKey(t.payee, t.purpose);
    if (!key) continue;
    const id = `${typeOf(t.amount)}|${key}`;
    const v = votes.get(id) || new Map();
    v.set(t.category, (v.get(t.category) || 0) + 1);
    votes.set(id, v);
  }
  learned = new Map([...votes].map(([id, v]) => [id, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
}

const learnedCategory = (payee, purpose, type) => {
  const key = type ? ruleKey(payee, purpose) : "";
  return key ? learned.get(`${type}|${key}`) || null : null;
};

export function autoCategory(payee, purpose, type) {
  const own = ruleCategory(payee, purpose, type);
  if (own) return own;
  const base = categorize(`${payee} ${purpose}`, type);
  if (!isFallbackCategory(base)) return base;
  return learnedCategory(payee, purpose, type) || base;
}

// Bereits gespeicherte Buchungen, die noch in "Sonstiges" liegen, mit den aktuellen Regeln neu zuordnen.
// Von dir manuell gesetzte Kategorien (categoryManual) bleiben unangetastet.
export async function recategorizeStored() {
  const all = await getAll("transactions");
  rebuildLearned(all);
  const updates = [];
  for (const t of all) {
    if (t.categoryManual || !isFallbackCategory(t.category)) continue;
    const next = autoCategory(t.payee, t.purpose, typeOf(t.amount));
    if (next !== t.category) updates.push({ ...t, category: next });
  }
  if (updates.length) await putBatch({ transactions: updates });
  return updates.length;
}

export async function saveRule(payee, purpose, type, category) {
  const key = ruleKey(payee, purpose);
  if (!key) return null;
  const existing = rules.find((r) => r.key === key && r.type === type);
  const rule = existing ? { ...existing, category } : { id: newId(), key, type, category, createdAt: new Date().toISOString() };
  await putBatch({ rules: [rule] });
  rules = existing ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
  return rule;
}

export async function removeRule(id) {
  await deleteRecord("rules", id);
  rules = rules.filter((r) => r.id !== id);
}
