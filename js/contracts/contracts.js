// Verträge & Anlagen: Erkennung wiederkehrender Ausgaben aus den importierten Transaktionen,
// Berechnung der Monats-/Jahresbelastung und lokale Speicherung der Entscheidungen des Nutzers.
//
// Ablauf der Erkennung:
//  1. Ausgaben nach Zahlungsempfänger (bei Zahlungsdienstleistern wie PayPal zusätzlich nach Verwendungszweck) gruppieren
//  2. pro Gruppe ähnliche Beträge zusammenfassen
//  3. Abstände zwischen den Zahlungen mit den Intervallen 1, 2, 3, 4, 6, 12, 24 Monate vergleichen
//  4. Vertrauenswert aus Regelmäßigkeit, Betragsstabilität, Zahltag und Anzahl der Zahlungen berechnen
// Ergebnis sind nur VORSCHLÄGE – der Nutzer bestätigt, bearbeitet oder ignoriert sie.
import { getAll, putBatch, deleteRecord, newId } from "../db/database.js";
import { normalizeText } from "../transactions/categories.js";

export const INTERVALS = [1, 2, 3, 4, 6, 12, 24];
export const INTERVAL_LABELS = {
  1: "monatlich", 2: "alle 2 Monate", 3: "alle 3 Monate", 4: "alle 4 Monate", 6: "alle 6 Monate", 12: "jährlich", 24: "alle 24 Monate"
};

const DAY_MS = 86400000;
const MONTH_DAYS = 30.4375;

/* ---------- Datum ---------- */

const pad = (n) => String(n).padStart(2, "0");
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dayNumber = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS;
export const monthsBetween = (from, to) => (dayNumber(to) - dayNumber(from)) / MONTH_DAYS;

export function addMonths(iso, months) {
  const total = +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1) + months;
  const year = Math.floor(total / 12), month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(+iso.slice(8, 10), lastDay))}`;
}

// Erster Termin der Reihe anchor + k·Intervall (k ≥ 0), der nicht vor `today` liegt.
export function nextOccurrence(anchor, interval, today = todayIso()) {
  let k = Math.max(0, Math.floor(monthsBetween(anchor, today) / interval) - 1);
  let date = addMonths(anchor, k * interval);
  while (date < today) date = addMonths(anchor, ++k * interval);
  return date;
}

/* ---------- Statistik-Helfer ---------- */

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const bucketOf = (cents) => Math.round(Math.log(Math.max(cents, 1)) / Math.log(1.3)); // ≈ ±30 %-Stufen

/* ---------- Gruppierung nach Zahlungsempfänger ---------- */

const NOISE = new Set([
  "gmbh", "ag", "kg", "co", "ltd", "inc", "se", "ev", "mbh", "ohg", "ug", "sagt", "danke", "markt", "filiale",
  "sepa", "lastschrift", "basislastschrift", "folgelastschrift", "kartenzahlung", "zahlung", "uberweisung", "ueberweisung",
  "dauerauftrag", "gutschrift", "abbuchung", "rechnung", "nr", "kd", "mandat", "mandatsref", "ref", "www", "com", "de", "eu",
  "bill", "europe", "sarl", "cie", "sca", "pp", "ihr", "einkauf", "bei", "und", "fur", "the", "dd"
]);
const PROCESSORS = new Set(["paypal", "klarna", "apple", "google", "stripe", "paddle", "adyen", "mollie", "sumup", "payone"]);

const significant = (text) => normalizeText(text).split(" ").filter((t) => t.length > 1 && !/\d/.test(t) && !NOISE.has(t));

export function groupKeyOf(tx) {
  const payee = significant(tx.payee || "");
  const purpose = significant(tx.purpose || "");
  if (payee.length && PROCESSORS.has(payee[0])) {
    return [payee[0], ...new Set(purpose.filter((t) => !PROCESSORS.has(t)))].slice(0, 3).join(" ");
  }
  return (payee.length ? payee : purpose).slice(0, 2).join(" ");
}

/* ---------- Anlage oder Vertrag? ---------- */

const INVEST_WORDS = [
  "etf", "sparplan", "wertpapier", "depot", "aktien", "fonds", "trade republic", "scalable", "flatex", "smartbroker",
  "consorsbank", "bitcoin", "crypto", "krypto", "coinbase", "bison", "investment", "vermoegenswirk"
].map(normalizeText);

export function isInvestment(text, category = "") {
  if (category === "Sparen & Anlage") return true;
  const hay = ` ${normalizeText(text)} `;
  return INVEST_WORDS.some((w) => hay.includes(` ${w}`));
}

// Alltagsausgaben, die nur bei exakt gleichem Betrag und mind. 4 Zahlungen als Vertrag vorgeschlagen werden.
const EVERYDAY_CATEGORIES = new Set(["Lebensmittel", "Restaurants & Café", "Bargeld", "Einkaufen"]);

/* ---------- Erkennung ---------- */

function expenseItems(transactions) {
  return transactions
    .filter((t) => t.amount < 0 && t.date)
    .map((t) => ({ id: t.id, date: t.date, cents: -t.amount, payee: t.payee || "", purpose: t.purpose || "", category: t.category || "", key: groupKeyOf(t) }))
    .filter((t) => t.key);
}

const indexByKey = (items) => {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.key)) map.set(item.key, []);
    map.get(item.key).push(item);
  }
  return map;
};

function clusterByAmount(items) {
  const sorted = [...items].sort((a, b) => a.cents - b.cents);
  const clusters = [];
  for (const item of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && item.cents <= current[0].cents * 1.2 + 30) current.push(item);
    else clusters.push([item]);
  }
  return clusters;
}

function displayName(items) {
  const counts = new Map();
  for (const item of items) {
    const name = (item.payee || item.purpose).replace(/\s+/g, " ").trim();
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  let name = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unbenannt";
  if (name.length > 3 && name === name.toUpperCase()) name = name.toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  name = name.replace(/\.(com|de|net|org)\b/gi, "");
  return name.length > 40 ? `${name.slice(0, 39)}…` : name;
}

const title = (text) => text.replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Bei Zahlungsdienstleistern (PayPal …) ist der eigentliche Anbieter im Verwendungszweck: "Spotify (PayPal)".
function nameFor(items, groupKey) {
  const [first, ...rest] = groupKey.split(" ");
  if (PROCESSORS.has(first) && rest.length) return `${title(rest.join(" "))} (${title(first)})`;
  return displayName(items);
}

function amountStats(items) {
  const cents = items.map((i) => i.cents);
  const avg = Math.round(mean(cents));
  const min = Math.min(...cents), max = Math.max(...cents);
  const recent = cents.slice(-6);
  return {
    amount: cents[cents.length - 1],
    avgAmount: Math.round(mean(recent)),
    minAmount: min,
    maxAmount: max,
    varies: max - min > Math.max(50, 0.02 * avg),
    spread: avg ? (max - min) / avg : 0
  };
}

// Prüft eine Zahlungsreihe auf ein festes Intervall. Gibt null zurück, wenn keine Regelmäßigkeit erkennbar ist.
function analyze(items, dataEnd, today, groupKey) {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const unique = sorted.filter((item, i) => i === 0 || item.date !== sorted[i - 1].date); // mehrere Buchungen am Tag = 1 Zahlung
  const n = unique.length;
  if (n < 2) return null;

  const days = unique.map((i) => dayNumber(i.date));
  const gaps = days.slice(1).map((d, i) => (d - days[i]) / MONTH_DAYS);
  if (median(gaps) < 0.6) return null; // zu häufig (z. B. Alltagseinkäufe)

  // Bestes Intervall: volle Punkte für passende Abstände, halbe Punkte bei ausgelassenen Zahlungen (2×/3× Intervall).
  let best = null;
  for (const interval of INTERVALS) {
    const tol = Math.max(0.35, 0.09 * interval);
    let strict = 0, partial = 0;
    for (const gap of gaps) {
      if (Math.abs(gap - interval) <= tol) strict++;
      else if ([2, 3].some((k) => interval * k <= 24 && Math.abs(gap - interval * k) <= tol * Math.sqrt(k))) partial++;
    }
    const score = strict + 0.5 * partial;
    if (!best || score > best.score || (score === best.score && interval > best.interval)) best = { interval, strict, score };
  }
  const coverage = best.score / gaps.length;
  const strictRatio = best.strict / gaps.length;
  const stats = amountStats(unique);

  if (n >= 3) {
    if (coverage < 0.75 || strictRatio < 0.6) return null;
  } else if (!(best.interval >= 6 && best.strict === 1 && stats.maxAmount / stats.minAmount <= 1.1)) {
    return null; // 2 Zahlungen reichen nur für halb-/jährliche Intervalle mit praktisch gleichem Betrag
  }

  const last = unique[unique.length - 1];
  const category = last.category;
  if (EVERYDAY_CATEGORIES.has(category) && !(stats.spread <= 0.01 && n >= 4)) return null;
  if (monthsBetween(last.date, dataEnd) > best.interval * 1.6 + 0.7) return null; // seit Langem keine Zahlung mehr

  const dom = unique.map((i) => +i.date.slice(8, 10));
  const domMedian = median(dom);
  const dayDeviation = median(dom.map((d) => { const x = Math.abs(d - domMedian); return Math.min(x, 30 - x); }));
  const dayStability = clamp01(1 - dayDeviation / 7);
  const amountStability = clamp01(1 - stats.spread * 1.5);

  let confidence = 0.35 * coverage + 0.2 * amountStability + 0.2 * dayStability + 0.15 * Math.min(1, n / 6) + 0.1 * strictRatio;
  confidence *= n >= 4 ? 1 : n === 3 ? 0.92 : 0.7;
  if (stats.spread > 0.5) confidence *= 0.85;

  const sampleText = `${last.payee} ${last.purpose}`;
  return {
    name: nameFor(unique, groupKey),
    kind: isInvestment(sampleText, category) ? "investment" : "contract",
    intervalMonths: best.interval,
    ...stats,
    count: n,
    firstDate: unique[0].date,
    lastDate: last.date,
    nextDate: nextOccurrence(addMonths(last.date, best.interval), best.interval, today),
    confidence: Math.round(clamp01(confidence) * 100) / 100,
    category,
    bucket: bucketOf(median(unique.map((i) => i.cents)))
  };
}

function analyzeGroup(items, dataEnd, today, groupKey) {
  const cents = items.map((i) => i.cents);
  const ratio = Math.max(...cents) / Math.min(...cents);
  const byDate = new Map();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) || []), item.cents]);
  const sameDayDiffers = [...byDate.values()].some((a) => a.length > 1 && Math.max(...a) / Math.min(...a) > 1.3);

  if (!sameDayDiffers && ratio <= 2.5) {
    const whole = analyze(items, dataEnd, today, groupKey);
    if (whole) return [whole];
  }
  return clusterByAmount(items).filter((c) => c.length >= 2).map((c) => analyze(c, dataEnd, today, groupKey)).filter(Boolean);
}

const sameContract = (record, groupKey, bucket) =>
  record.groupKey === groupKey && (record.bucket == null || Math.abs(record.bucket - bucket) <= 2);

// Liefert Vorschläge (ohne bereits bestätigte oder ignorierte), sortiert nach Vertrauenswert.
export function detectSuggestions(transactions, records = [], { today = todayIso(), minConfidence = 0.5 } = {}) {
  const items = expenseItems(transactions);
  const dataEnd = transactions.reduce((max, t) => (t.date && t.date > max ? t.date : max), "0000-00-00");
  if (!items.length) return [];
  const suggestions = [];
  for (const [groupKey, group] of indexByKey(items)) {
    if (group.length < 2) continue;
    for (const candidate of analyzeGroup(group, dataEnd, today, groupKey)) {
      if (candidate.confidence < minConfidence) continue;
      if (records.some((r) => sameContract(r, groupKey, candidate.bucket))) continue;
      suggestions.push({ ...candidate, key: `${groupKey}|${candidate.bucket}`, groupKey });
    }
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence || b.amount - a.amount);
}

/* ---------- Bestätigte Verträge / Anlagen ---------- */

export const costBasis = (c) => (c.varies && c.avgAmount ? c.avgAmount : c.amount);
export const monthlyCost = (c) => Math.round(costBasis(c) / c.intervalMonths);
export const yearlyCost = (c) => Math.round((costBasis(c) * 12) / c.intervalMonths);

export const listContracts = () => getAll("contracts");
export const saveContract = (record) => putBatch({ contracts: [record] });
export const removeContract = (id) => deleteRecord("contracts", id);

export const createContract = ({ name, kind, amount, intervalMonths, nextDate, groupKey = null, bucket = null, source = "manual" }) => ({
  id: newId(), status: "active", name: String(name).trim(), kind, amount, intervalMonths, nextDate, groupKey, bucket, source,
  createdAt: new Date().toISOString()
});

export const createIgnored = (suggestion) => ({
  id: newId(), status: "ignored", name: suggestion.name, kind: suggestion.kind, groupKey: suggestion.groupKey, bucket: suggestion.bucket,
  createdAt: new Date().toISOString()
});

// Anzeige-Modell eines bestätigten Eintrags. Zahlungen neuer Importe werden live berücksichtigt
// (letzte Zahlung, Durchschnitt bei schwankendem Betrag), ohne den gespeicherten Eintrag zu ändern.
export function describeContract(record, transactions, { today = todayIso() } = {}) {
  const items = expenseItems(transactions);
  const dataEnd = transactions.reduce((max, t) => (t.date && t.date > max ? t.date : max), "0000-00-00");
  const matches = record.groupKey
    ? items.filter((i) => i.key === record.groupKey && (record.bucket == null || Math.abs(bucketOf(i.cents) - record.bucket) <= 3))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  let anchor = record.nextDate;
  let live = null;
  if (matches.length) {
    const cents = matches.map((m) => m.cents);
    const min = Math.min(...cents), max = Math.max(...cents), avg = mean(cents);
    live = {
      lastDate: matches[matches.length - 1].date, count: matches.length, min, max,
      avg: Math.round(mean(cents.slice(-6))), varies: max - min > Math.max(50, 0.02 * avg)
    };
    const fromPayment = addMonths(live.lastDate, record.intervalMonths);
    if (fromPayment > anchor) anchor = fromPayment;
  }
  const view = {
    ...record,
    avgAmount: live?.avg ?? null, minAmount: live?.min ?? null, maxAmount: live?.max ?? null, varies: Boolean(live?.varies),
    lastPaid: live?.lastDate ?? null, paymentCount: live?.count ?? 0,
    nextDate: nextOccurrence(anchor, record.intervalMonths, today),
    ended: Boolean(live) && monthsBetween(live.lastDate, dataEnd) > record.intervalMonths * 1.6 + 0.7
  };
  view.monthly = monthlyCost(view);
  view.yearly = yearlyCost(view);
  return view;
}

export function totals(views) {
  const sum = (kind, field) => views.filter((v) => v.kind === kind).reduce((total, v) => total + v[field], 0);
  return {
    contractMonthly: sum("contract", "monthly"), contractYearly: sum("contract", "yearly"),
    investmentMonthly: sum("investment", "monthly"), investmentYearly: sum("investment", "yearly"),
    contractCount: views.filter((v) => v.kind === "contract").length,
    investmentCount: views.filter((v) => v.kind === "investment").length
  };
}
