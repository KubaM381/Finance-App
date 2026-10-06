// CSV-Import: Kodierung, Trennzeichen, Kopfzeile und Spalten werden automatisch erkannt.
// Neue Bankformate: Einträge in CSV_PROFILES ergänzen (Erkennung + optionale Optionen). Die Spaltenzuordnung
// selbst läuft über FIELDS und deckt viele deutsche Banken bereits allgemein ab.
import { makeDraft, parseAmount, parseDate, ImportError } from "../transactions/transactions.js";
import { findIban } from "../accounts/accounts.js";

/* Format-Profile: detect(headerSet) bekommt die normalisierten Spaltennamen. `invertSign: true` dreht Beträge um
   (z. B. Kreditkarten-Exporte, bei denen Käufe positiv sind). */
export const CSV_PROFILES = [
  { id: "sparkasse", name: "Sparkasse / CAMT-CSV", detect: (h) => h.has("auftragskonto") && h.has("beguenstigter/zahlungspflichtiger") },
  { id: "volksbank", name: "Volks- und Raiffeisenbank", detect: (h) => h.has("iban auftragskonto") },
  { id: "ing", name: "ING", detect: (h) => h.has("auftraggeber/empfaenger") && h.has("saldo") },
  { id: "dkb", name: "DKB", detect: (h) => h.has("zahlungspflichtiger") && h.has("zahlungsempfaengerin") },
  { id: "comdirect", name: "comdirect", detect: (h) => h.has("vorgang") && h.has("umsatz in eur") },
  { id: "n26", name: "N26", detect: (h) => h.has("payee") && h.has("payment reference") },
  { id: "generic", name: "Allgemeines CSV", detect: () => true }
];

const FIELDS = [
  ["ownIban", /^(auftragskonto|iban auftragskonto|eigene iban|konto iban|iban konto|eigenes konto)$/],
  ["accountName", /^bezeichnung auftragskonto$/],
  ["valueDate", /^(wertstellung|valuta|valutadatum|wertstellungsdatum|value date)$/],
  ["date", /^(buchungstag|buchungsdatum|buchung|datum|date|booking date|transaction date|transaktionsdatum)$/],
  ["sh", /^(soll\/haben|s\/h|soll haben|debit\/credit)$/],
  ["amount", /^(betrag|umsatz|amount|betrag in eur|umsatz in eur|umsatz in euro|transaction amount|betrag eur|summe)$/],
  ["debit", /^(soll|belastung|ausgaben?|debit|abbuchung|ausgang)$/],
  ["credit", /^(haben|gutschrift|einnahmen?|credit|eingang|zahlungseingang)$/],
  ["payer", /^zahlungspflichtige(r|n)?$/],
  ["recipient", /^(zahlungsempfaenger(in)?|empfaenger(in)?|beguenstigte(r)?|payee|beneficiary|recipient)$/],
  ["party", /^(beguenstigter|zahlungspflichtiger|empfaenger|auftraggeber|name|name zahlungspartner|name zahlungsbeteiligter|zahlungsbeteiligter|zahlungspartner|counterparty|gegenpartei)(\/(beguenstigter|zahlungspflichtiger|empfaenger|auftraggeber))*$/],
  ["purpose", /^(verwendungszweck|zweck|beschreibung|description|reference|payment reference|buchungsdetails|mitteilung|details|transaktionsbeschreibung|memo|narrative|bemerkung|text|verwendungszweckzeile \d+)$/],
  ["kind", /^(buchungstext|vorgang|umsatztyp|umsatzart|transaction type|buchungsart)$/],
  ["currency", /^(waehrung|currency)$/]
];

export function normHeader(value) {
  return String(value)
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- Einlesen ---------- */

export async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes); // typisch für ältere Bank-Exporte
  }
}

function countOutsideQuotes(line, delimiter) {
  let inQuotes = false, count = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) count++;
  }
  return count;
}

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 40);
  let best = ";", bestScore = 0;
  for (const delimiter of [";", ",", "\t", "|"]) {
    const freq = new Map();
    for (const line of lines) {
      const c = countOutsideQuotes(line, delimiter);
      if (c > 0) freq.set(c, (freq.get(c) || 0) + 1);
    }
    let mode = 0, modeN = 0;
    for (const [c, n] of freq) if (n > modeN || (n === modeN && c > mode)) { mode = c; modeN = n; }
    const score = modeN * 1000 + mode;
    if (mode > 0 && score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/* ---------- Spalten ---------- */

function mapColumns(cells) {
  const cols = {}, names = new Set();
  cells.forEach((cell, index) => {
    const h = normHeader(cell);
    if (!h) return;
    names.add(h);
    for (const [name, re] of FIELDS) {
      if (re.test(h)) { (cols[name] ||= []).push(index); break; }
    }
  });
  return { cols, names };
}

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const { cols, names } = mapColumns(rows[r]);
    if ((cols.date || cols.valueDate) && (cols.amount || cols.debit || cols.credit)) return { index: r, cols, names };
  }
  return null;
}

const looksLikeAmount = (c) => /[.,]\d{2}(?!\d)/.test(c) && parseAmount(c) != null && parseDate(c) == null;

// Ohne Kopfzeile: Spalten anhand der Inhalte schätzen.
function guessColumns(rows) {
  const sample = rows.slice(0, 200);
  const width = Math.max(...sample.map((r) => r.length));
  const stats = [];
  for (let c = 0; c < width; c++) {
    const cells = sample.map((r) => r[c] || "").filter(Boolean);
    const n = Math.max(cells.length, 1);
    stats.push({
      c,
      date: cells.filter((x) => parseDate(x)).length / n,
      amount: cells.filter(looksLikeAmount).length / n,
      text: cells.filter((x) => !parseDate(x) && !looksLikeAmount(x) && x.length > 3).length / n
    });
  }
  const dateCol = stats.find((s) => s.date >= 0.6);
  const amountCol = stats.find((s) => s.amount >= 0.6 && s.c !== dateCol?.c);
  if (!dateCol || !amountCol) return null;
  const textCols = stats.filter((s) => s.text >= 0.5 && s.c !== dateCol.c && s.c !== amountCol.c).map((s) => s.c);
  const cols = { date: [dateCol.c], amount: [amountCol.c] };
  if (textCols.length > 1) { cols.party = [textCols[0]]; cols.purpose = textCols.slice(1); }
  else if (textCols.length === 1) cols.purpose = textCols;
  return cols;
}

const first = (row, indices = []) => {
  for (const i of indices) {
    const value = (row[i] ?? "").trim();
    if (value) return value;
  }
  return "";
};

function readAmount(row, cols) {
  let cents = parseAmount(first(row, cols.amount));
  if (cols.debit || cols.credit) {
    const debit = parseAmount(first(row, cols.debit));
    const credit = parseAmount(first(row, cols.credit));
    if (cents == null && (debit != null || credit != null)) cents = (credit ?? 0) - Math.abs(debit ?? 0);
  }
  if (cents != null && cols.sh) {
    const flag = first(row, cols.sh).toUpperCase();
    if (/^(S|D|SOLL|DEBIT)/.test(flag)) cents = -Math.abs(cents);
    else if (/^(H|C|HABEN|CREDIT)/.test(flag)) cents = Math.abs(cents);
  }
  return cents;
}

/* ---------- Hauptfunktionen ---------- */

export async function parseCsvFile(file) {
  return parseCsvText(await readText(file));
}

export function parseCsvText(text) {
  const rows = parseCsv(text, detectDelimiter(text));
  if (rows.length < 2) throw new ImportError("Die CSV-Datei enthält keine Buchungszeilen.");

  const warnings = [];
  let cols, startRow, names = new Set(), preambleRows = [];
  const header = findHeader(rows);
  if (header) {
    ({ cols, names } = header);
    startRow = header.index + 1;
    preambleRows = rows.slice(0, header.index);
  } else {
    cols = guessColumns(rows);
    if (!cols) throw new ImportError("In der CSV-Datei wurden keine Datums- und Betragsspalten erkannt. Bitte prüfe, ob es sich um einen Kontoauszug handelt.");
    startRow = 0;
    warnings.push("Keine Kopfzeile erkannt – die Spalten wurden anhand der Inhalte geschätzt. Bitte Vorschau genau prüfen.");
  }
  const profile = CSV_PROFILES.find((p) => p.detect(names)) || CSV_PROFILES[CSV_PROFILES.length - 1];
  const sign = profile.invertSign ? -1 : 1;

  const drafts = [];
  const dataRows = rows.slice(startRow);
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    const rawText = row.join(" · ");
    const dateText = first(row, cols.date) || first(row, cols.valueDate);
    let date = parseDate(first(row, cols.date)) || parseDate(first(row, cols.valueDate));
    const amount = readAmount(row, cols);

    if (!date && amount == null) {
      const filled = row.filter(Boolean).length;
      if (filled <= 2 || /saldo|kontostand|summe|umsatz gesamt/i.test(rawText) || (!header && r === 0)) continue;
    } else if (!date && /saldo|kontostand|summe/i.test(rawText) && amount != null && !dateText) continue;
    if (!header && r === 0 && !date) continue;

    let payee;
    if (cols.payer && cols.recipient) payee = amount != null && amount >= 0 ? first(row, cols.payer) || first(row, cols.recipient) : first(row, cols.recipient) || first(row, cols.payer);
    else payee = first(row, cols.party) || first(row, cols.recipient) || first(row, cols.payer);

    const purposeParts = cols.purpose ? cols.purpose.map((i) => row[i] || "") : [];
    let purpose = purposeParts.join(" ");
    if (!purpose.trim() && cols.kind) purpose = cols.kind.map((i) => row[i] || "").join(" ");

    const currency = first(row, cols.currency).toUpperCase();
    drafts.push(makeDraft({
      date,
      amount: amount == null ? null : amount * sign,
      payee,
      purpose,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
      raw: rawText
    }));
  }

  // Eigene IBAN: eigene Spalte oder Kopfbereich der Datei (die allgemeine "IBAN"-Spalte ist meist die Gegenseite).
  let iban = "";
  for (const i of cols.ownIban || []) { iban = findIban(dataRows.map((row) => row[i]).find(Boolean) || ""); if (iban) break; }
  if (!iban) iban = findIban(preambleRows.map((row) => row.join(" ")).join("\n"));

  const accountName = cols.accountName ? first(dataRows[0] || [], cols.accountName) : "";
  const currencies = new Set(drafts.map((d) => d.currency));
  return {
    drafts,
    warnings,
    meta: { format: "csv", profile: profile.name, iban, accountName, currency: currencies.size === 1 ? [...currencies][0] : "EUR" }
  };
}
