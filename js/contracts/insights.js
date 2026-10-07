// Zusatzinfos zu bestätigten Verträgen: Preiserhöhung und Kündigungsfrist (ohne Änderung an contracts.js).
import { groupKeyOf, addMonths } from "./contracts.js";

export const NOTICE_UNITS = { days: "Tage", weeks: "Wochen", months: "Monate" };

const bucketOf = (cents) => Math.round(Math.log(Math.max(cents, 1)) / Math.log(1.3)); // wie in contracts.js
const close = (a, b) => Math.abs(a - b) <= Math.max(5, 0.01 * Math.max(a, b));

// Erkennt "lange gleicher Betrag, dann plötzlich teurer" in den letzten zwei Zahlungen.
// Schwankende Beträge (z. B. Strom-Abschläge mit Nachzahlung) lösen bewusst keine Warnung aus.
export function priceChange(record, transactions) {
  if (!record.groupKey) return null;
  const byDate = new Map();
  for (const t of transactions) {
    if (t.amount >= 0 || !t.date || groupKeyOf(t) !== record.groupKey) continue;
    if (record.bucket != null && Math.abs(bucketOf(-t.amount) - record.bucket) > 3) continue;
    byDate.set(t.date, -t.amount);
  }
  const dates = [...byDate.keys()].sort();
  const c = dates.map((d) => byDate.get(d));
  for (let j = c.length - 1; j >= Math.max(2, c.length - 2); j--) {
    if (c[j] >= c[j - 1] * 1.03 && c[j] - c[j - 1] >= 50 && close(c[j - 1], c[j - 2]) && c.slice(j).every((x) => close(x, c[j]))) {
      return { from: c[j - 1], to: c[j], date: dates[j], percent: Math.round((c[j] / c[j - 1] - 1) * 100) };
    }
  }
  return null;
}

// Letzter Tag, an dem gekündigt werden kann (Vertragsende minus Kündigungsfrist).
export function cancelBy(record) {
  const value = Number(record.noticeValue);
  if (!record.endDate || !value) return null;
  if (record.noticeUnit === "months") return addMonths(record.endDate, -value);
  const d = new Date(`${record.endDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - value * (record.noticeUnit === "weeks" ? 7 : 1));
  return d.toISOString().slice(0, 10);
}

export const daysUntil = (iso, today) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
