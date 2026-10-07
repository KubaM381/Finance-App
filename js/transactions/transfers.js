// Umbuchungen zwischen eigenen Konten erkennen: gleicher Betrag, einmal Ausgabe, einmal Einnahme auf einem
// anderen Konto, höchstens 3 Tage Abstand. Solche Paare zählen nicht als Einnahme/Ausgabe.
// Manuelle Entscheidung des Nutzers: Feld `transfer` (true/false) am Datensatz; ohne Feld gilt die Erkennung.
const DAY = 86400000;
const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
const gap = (a, b) => Math.abs(dayNum(a.date) - dayNum(b.date));

export function findTransfers(transactions, maxDays = 3) {
  const ids = new Set(), used = new Set(), incomes = new Map();
  for (const t of transactions) {
    if (t.amount > 0 && t.transfer == null && t.date) {
      if (!incomes.has(t.amount)) incomes.set(t.amount, []);
      incomes.get(t.amount).push(t);
    }
  }
  const outs = transactions.filter((t) => t.amount < 0 && t.transfer == null && t.date).sort((a, b) => a.date.localeCompare(b.date));
  for (const out of outs) {
    const match = (incomes.get(-out.amount) || [])
      .filter((i) => !used.has(i.id) && i.accountId !== out.accountId && gap(i, out) <= maxDays)
      .sort((a, b) => gap(a, out) - gap(b, out))[0];
    if (match) { used.add(match.id); ids.add(out.id); ids.add(match.id); }
  }
  return ids;
}

export const isTransfer = (t, auto) => t.transfer === true || (t.transfer == null && auto.has(t.id));

// Gegenbuchung zu einer Umbuchung (damit beide Seiten gemeinsam markiert werden können).
export function partnerOf(t, all, maxDays = 3) {
  return all
    .filter((x) => x.id !== t.id && x.amount === -t.amount && x.accountId !== t.accountId && x.date && gap(x, t) <= maxDays)
    .sort((a, b) => gap(a, t) - gap(b, t))[0] || null;
}
