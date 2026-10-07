// Eigene Kategorie-Regeln: "Buchungen von diesem Empfänger immer in Kategorie X".
// Die Regeln liegen in IndexedDB (Store "rules") und werden beim Start in den Speicher geladen,
// damit die Kategorisierung beim Import synchron darauf zugreifen kann.
import { getAll, putBatch, deleteRecord, newId } from "../db/database.js";
import { normalizeText } from "./categories.js";

const PROCESSORS = new Set(["paypal", "klarna", "stripe", "paddle", "adyen", "mollie", "sumup", "payone", "apple", "google"]);
let rules = [];

const tokens = (text) => normalizeText(text).split(" ").filter((t) => t.length > 1 && !/\d/.test(t));

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
