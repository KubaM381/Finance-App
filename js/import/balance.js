// Kontostand aus dem Kontoauszug lesen (soweit vorhanden):
//  - PDF: Zeilen wie "Neuer Saldo 1.234,56 H" oder "Kontostand am 31.10.2026 1.234,56 EUR"
//  - CSV: Kopf-/Fußzeilen ("Kontostand vom …", "Saldo") oder eine Saldo-Spalte (Stand der neuesten Buchung)
// Alles lokal im Browser. Gibt { cents, date } zurück oder null, wenn nichts Eindeutiges gefunden wurde.
import { loadPdfjs, extractLines } from "./pdf.js";
import { readText, detectDelimiter, parseCsv, normHeader } from "./csv.js";
import { parseAmount, parseDate } from "../transactions/transactions.js";

const LABEL = /(kontostand|saldo)/i;
const SKIP = /\b(alter|bisheriger|vorheriger|anfangssaldo|startsaldo)\b|vortrag|zwischensaldo|zwischensumme/i;
const DATE_RE = /\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?(?!\d)/g;
const AMOUNT_RE = /[+\-−–]?\s?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d)(?:\s?(?:[SH]\b|[+\-−–](?!\s?\d)))?/;

// Eine Textzeile mit Bezeichnung (Saldo/Kontostand) und Betrag auswerten.
function fromLine(text) {
  if (!LABEL.test(text) || SKIP.test(text)) return null;
  const dateMatch = text.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/);
  const amount = text.replace(DATE_RE, " ").match(AMOUNT_RE);
  const cents = amount ? parseAmount(amount[0]) : null;
  if (cents == null) return null;
  return { cents, date: dateMatch ? parseDate(dateMatch[0]) : null, strong: /neu|aktuell|\bend|schluss|\b(am|zum|vom)\b/i.test(text) };
}

const pick = (candidates) => [...candidates].reverse().find((c) => c.strong) || candidates[candidates.length - 1] || null;

async function pdfBalance(file) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false }).promise;
  try {
    const lines = await extractLines(pdf);
    return pick(lines.map((line) => fromLine(line.text)).filter(Boolean));
  } finally {
    await pdf.destroy();
  }
}

const BALANCE_HEAD = /^(saldo|saldo nach buchung|saldo nach transaktion|kontostand|balance|saldo in eur|saldo eur)$/;
const DATE_HEAD = /^(buchungstag|buchungsdatum|buchung|datum|date|valuta|wertstellung)$/;

async function csvBalance(file) {
  const text = await readText(file);
  const rows = parseCsv(text, detectDelimiter(text));

  // 1) Kopf-/Fußzeilen mit wenigen Zellen, z. B. "Kontostand vom 04.10.2026:";"1.234,56 EUR"
  const notes = [];
  for (const row of rows) {
    const cells = row.filter(Boolean);
    if (cells.length && cells.length <= 4) {
      const hit = fromLine(cells.join(" "));
      if (hit) notes.push(hit);
    }
  }
  if (notes.length) return pick(notes);

  // 2) Saldo-Spalte: Stand nach der neuesten Buchung
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const heads = rows[r].map(normHeader);
    const bal = heads.findIndex((h) => BALANCE_HEAD.test(h));
    const dat = heads.findIndex((h) => DATE_HEAD.test(h));
    if (bal < 0 || dat < 0) continue;
    const entries = [];
    rows.slice(r + 1).forEach((row, index) => {
      const date = parseDate(row[dat] || "");
      const cents = parseAmount(row[bal] || "");
      if (date && cents != null) entries.push({ date, cents, index });
    });
    if (!entries.length) return null;
    const ascending = entries[0].date <= entries[entries.length - 1].date;
    let best = entries[0];
    for (const e of entries) if (e.date > best.date || (e.date === best.date && ascending)) best = e;
    return { cents: best.cents, date: best.date };
  }
  return null;
}

export async function readBalance(file, kind, drafts = []) {
  const found = kind === "pdf" ? await pdfBalance(file) : await csvBalance(file);
  if (!found) return null;
  const latest = drafts.reduce((max, d) => (d.date && d.date > max ? d.date : max), "");
  return { cents: found.cents, date: found.date || latest || null };
}
