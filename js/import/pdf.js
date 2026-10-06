// PDF-Import: Text wird lokal mit pdf.js (js/vendor/pdfjs) ausgelesen, in Zeilen/Spalten gruppiert und
// zu Buchungen zusammengesetzt. Es werden keine Daten übertragen.
// Neue Bankformate: Eintrag in PDF_PROFILES ergänzen (detect(text) + parse(lines, ctx)).
import { makeDraft, parseAmount, parseDate, ImportError } from "../transactions/transactions.js";
import { findIban } from "../accounts/accounts.js";

const PDFJS_URL = new URL("../vendor/pdfjs/pdf.min.mjs", import.meta.url).href;
const WORKER_URL = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
let pdfjsPromise = null;

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

export async function parsePdfFile(file) {
  const pdfjs = await loadPdfjs();
  return parsePdfData(new Uint8Array(await file.arrayBuffer()), pdfjs);
}

export async function parsePdfData(data, pdfjs) {
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false }).promise;
  } catch (error) {
    if (error?.name === "PasswordException") throw new ImportError("Das PDF ist passwortgeschützt. Bitte zuerst ohne Passwort speichern oder als CSV exportieren.");
    throw new ImportError("Das PDF konnte nicht gelesen werden. Möglicherweise ist die Datei beschädigt.");
  }
  try {
    const lines = await extractLines(pdf);
    if (!lines.length) throw new ImportError("Im PDF wurde kein Text gefunden (vermutlich ein Scan oder Foto). Texterkennung (OCR) wird nicht unterstützt – bitte die PDF direkt im Online-Banking herunterladen oder CSV verwenden.");
    const result = parseStatementLines(lines);
    result.meta.pages = pdf.numPages;
    return result;
  } finally {
    await pdf.destroy();
  }
}

/* ---------- Text → Zeilen ---------- */

export async function extractLines(pdf) {
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);

    // Safari-Versionen, in denen ReadableStream nicht async-iterierbar ist,
    // werfen innerhalb von PDF.js bei page.getTextContent() den Fehler
    // "undefined is not a function". Die Reader-API funktioniert dort weiterhin.
    const textItems = [];
    const reader = page.streamTextContent().getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value?.items?.length) textItems.push(...value.items);
    }
    const items = textItems
      .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) || 8 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let current = null;
    for (const item of items) {
      if (current && Math.abs(current.y - item.y) <= Math.max(2.5, Math.min(current.h, item.h) * 0.4)) current.items.push(item);
      else { current = { page: p, y: item.y, h: item.h, items: [item] }; lines.push(current); }
    }
    page.cleanup();
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let text = "", prevEnd = null;
    for (const item of line.items) {
      if (prevEnd !== null) {
        const gap = item.x - prevEnd;
        text += gap > 8 ? "  " : gap > 0.5 ? " " : "";
      }
      text += item.str.trim();
      prevEnd = item.x + item.w;
    }
    line.text = text;
  }
  return lines;
}

function tokensOf(line) {
  if (line.tokens) return line.tokens;
  const out = [];
  if (line.items) {
    for (const item of line.items) {
      const len = item.str.length || 1;
      for (const m of item.str.matchAll(/\S+/g)) {
        out.push({ s: m[0], x0: item.x + item.w * (m.index / len), x1: item.x + item.w * ((m.index + m[0].length) / len) });
      }
    }
  } else {
    for (const s of line.text.split(/\s+/).filter(Boolean)) out.push({ s, x0: NaN, x1: NaN });
  }
  return (line.tokens = out);
}

/* ---------- Zeilen → Buchungen ---------- */

const DATE_TOKEN = /^(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))$/;
const AMT_TOKEN = /^([+\-−–]?)(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})([+\-−–]?)$/;
const SIGN_TOKEN = /^(?:[+\-−–]|S|H|SOLL|HABEN)$/i;
const CUR_TOKEN = /^(?:EUR|€)$/i;
const STOP_RE = /^(seite|page)\s+\d|(alter|neuer)\s+(saldo|kontostand)|kontostand\s+(am|zum)|[uü]bertrag|^summe\b|^kontoauszug\b|^(bic|iban)\b|^(bankverbindung|steuer-?nr|ust-?id|amtsgericht|vorstand)/i;
const BALANCE_RE = /saldo|kontostand|[uü]bertrag|zwischensumme/i;
const HEADER_WORDS = ["buchung", "valuta", "wertstellung", "vorgang", "verwendungszweck", "soll", "haben", "betrag", "saldo", "beschreibung", "text", "datum", "umsatz"];
const SIGN_PAIRS = [["soll", "haben"], ["belastung", "gutschrift"], ["ausgaben", "einnahmen"], ["ausgang", "eingang"], ["debit", "credit"]];
const INCOME_RE = /gutschrift|gehalt|lohn|eingang|erstattung|r[uü]ckzahlung|zinsen|dividende|rente|kindergeld|retoure|bez[uü]ge/i;
const TYPE_RE = /^((?:sepa[-\s])?(?:basis|firmen|folge|erst)?(?:lastschrift|[uü]berweisung|ueberweisung|gutschrift|dauerauftrag|kartenzahlung|girocard|bargeldauszahlung|entgelt|abschluss|umbuchung|abbuchung|storno)[\wäöüß-]*)\s*/i;

const isHeaderLine = (line) => {
  const t = line.text.toLowerCase();
  if (DATE_TOKEN.test(tokensOf(line)[0]?.s || "")) return false;
  return HEADER_WORDS.filter((w) => new RegExp(`(^|[^a-zäöü])${w}`).test(t)).length >= 2;
};

function signColumns(line) {
  const tokens = tokensOf(line).map((t) => ({ ...t, k: t.s.toLowerCase().replace(/[^a-zäöü]/g, "") }));
  for (const [neg, pos] of SIGN_PAIRS) {
    const n = tokens.find((t) => t.k === neg), p = tokens.find((t) => t.k === pos);
    if (n && p && !Number.isNaN(n.x0)) return { neg: (n.x0 + n.x1) / 2, pos: (p.x0 + p.x1) / 2 };
  }
  return null;
}

// Beträge am Zeilenende (Betrag, optional Saldo; Vorzeichen als eigenes Token oder angehängt).
function tailAmounts(tokens) {
  const found = [];
  let pending = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const s = tokens[i].s;
    if (CUR_TOKEN.test(s)) continue;
    if (SIGN_TOKEN.test(s)) { pending = /^(-|−|–|S|SOLL)$/i.test(s) ? -1 : 1; continue; }
    const m = s.match(AMT_TOKEN);
    if (!m) break;
    const mark = m[1] || m[3];
    const explicit = mark ? (mark === "+" ? 1 : -1) : pending;
    found.unshift({ index: i, token: tokens[i], cents: Math.abs(parseAmount(m[2])), sign: explicit });
    pending = 0;
  }
  return found;
}

function splitDescription(firstText, extras) {
  let type = "", rest = firstText;
  const m = firstText.match(TYPE_RE);
  if (m) { type = m[1]; rest = firstText.slice(m[0].length); }
  const lines = [...extras];
  let payee = rest.trim();
  if (!payee && lines.length) payee = lines.shift();
  return { payee, purpose: [type, ...lines].filter(Boolean).join(" · ") };
}

function parseGeneric(lines) {
  const fullText = lines.map((l) => l.text).join("\n");
  const warnings = [];
  const iban = findIban(fullText);

  // Jahr für Buchungen ohne Jahresangabe ("01.10.")
  const years = new Map();
  for (const m of fullText.matchAll(/\b\d{1,2}\.\d{1,2}\.(\d{4})\b/g)) years.set(+m[1], (years.get(+m[1]) || 0) + 1);
  const range = fullText.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(?:bis|-|–)\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  const topYear = [...years.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? new Date().getFullYear();
  const yearFor = range && range[3] !== range[6]
    ? (month) => (month >= +range[2] ? +range[3] : +range[6])
    : () => topYear;
  let usedImplicitYear = false;
  const ctx = { yearFor: (month) => { usedImplicitYear = true; return yearFor(month); } };

  const blocks = [];
  let block = null, cols = null, hasSaldo = false;
  for (const line of lines) {
    const tokens = tokensOf(line);
    if (isHeaderLine(line)) {
      block = null;
      cols = signColumns(line) || cols;
      if (/saldo|kontostand/i.test(line.text)) hasSaldo = true;
      continue;
    }
    if (tokens.length && DATE_TOKEN.test(tokens[0].s) && !BALANCE_RE.test(line.text)) {
      block = { line, cols, extras: [] };
      blocks.push(block);
    } else if (block) {
      if (STOP_RE.test(line.text) || BALANCE_RE.test(line.text)) block = null;
      else block.extras.push(line);
    }
  }
  if (!blocks.length) {
    throw new ImportError("Im PDF wurden keine Buchungszeilen erkannt. Unterstützt werden Kontoauszüge, bei denen jede Buchung mit einem Datum beginnt. Bitte alternativ CSV verwenden.");
  }

  const drafts = blocks.map((b) => {
    const tokens = tokensOf(b.line);
    let skip = 1;
    if (tokens[1] && DATE_TOKEN.test(tokens[1].s)) skip = 2; // zweites Datum = Valuta
    const date = parseDate(tokens[0].s, ctx);

    // Betrag: zuerst am Ende der Datumszeile, sonst in den Folgezeilen
    let amountLine = b.line, lineTokens = tokens, amounts = tailAmounts(tokens.slice(skip).map((t, i) => ({ ...t, i: i + skip })));
    amounts = amounts.map((a) => ({ ...a, index: a.index + skip }));
    let extraLines = b.extras;
    if (!amounts.length) {
      for (const extra of b.extras) {
        const et = tokensOf(extra);
        const found = tailAmounts(et);
        if (found.length) { amountLine = extra; lineTokens = et; amounts = found; break; }
      }
    }
    let chosen = null, note = null;
    if (amounts.length >= 2) {
      chosen = hasSaldo ? amounts[amounts.length - 2] : amounts[amounts.length - 1];
      if (!hasSaldo) note = { text: "Mehrere Beträge in der Zeile – bitte prüfen, ob der richtige Betrag erkannt wurde", field: "amount" };
    } else if (amounts.length === 1) chosen = amounts[0];

    // Beschreibung ohne Datum/Beträge
    const descFirst = (amountLine === b.line
      ? tokens.slice(skip, amounts.length ? amounts[0].index : undefined)
      : tokens.slice(skip)).map((t) => t.s).join(" ");
    const cleanText = (t) => t.replace(/\b(valuta|wertstellung)\b:?\s*(\d{1,2}\.\d{1,2}\.(\d{2,4})?)?/gi, "").replace(/\s+/g, " ").replace(/\s[-+]$/, "").trim();
    const extras = extraLines
      .map((l) => (l === amountLine ? lineTokens.slice(0, amounts.length ? amounts[0].index : undefined).map((t) => t.s).join(" ") : l.text))
      .map(cleanText).filter(Boolean);
    const { payee, purpose } = splitDescription(cleanText(descFirst), extras);

    // Vorzeichen: explizit → Soll/Haben-Spalte → Textindiz → Ausgabe (mit Hinweis)
    let amount = null;
    if (chosen) {
      let sign = chosen.sign;
      if (!sign && b.cols && !Number.isNaN(chosen.token.x0)) {
        const centre = (chosen.token.x0 + chosen.token.x1) / 2;
        sign = Math.abs(centre - b.cols.neg) <= Math.abs(centre - b.cols.pos) ? -1 : 1;
      }
      if (!sign) {
        sign = INCOME_RE.test(`${payee} ${purpose}`) ? 1 : -1;
        note = note || { text: "Vorzeichen nicht eindeutig im PDF – automatisch geschätzt, bitte prüfen", field: "amount" };
      }
      amount = sign * chosen.cents;
    }
    return makeDraft({
      date, amount, payee, purpose,
      notes: [note].filter(Boolean),
      raw: [b.line.text, ...b.extras.map((l) => l.text)].join(" | ")
    });
  });

  if (usedImplicitYear) warnings.push(`Buchungen ohne Jahresangabe: Das Jahr wurde aus dem Kontoauszug abgeleitet (${topYear}).`);
  return {
    drafts,
    warnings,
    meta: { format: "pdf", profile: "Allgemeiner Kontoauszug", iban, accountName: "", currency: "EUR" }
  };
}

// Format-Profile: detect(text) entscheidet, parse(lines) liefert { drafts, warnings, meta }.
// Eigene Bankformate vor "generic" einfügen.
export const PDF_PROFILES = [
  { id: "generic", name: "Allgemeiner Kontoauszug", detect: () => true, parse: parseGeneric }
];

export function parseStatementLines(lines) {
  const text = lines.map((l) => l.text).join("\n");
  const profile = PDF_PROFILES.find((p) => p.detect(text)) || PDF_PROFILES[PDF_PROFILES.length - 1];
  const result = profile.parse(lines);
  result.meta.profile = profile.name;
  return result;
}
