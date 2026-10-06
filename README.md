# Finance App

Private, offline-first personal finance PWA.

## Principles

- Local-first: financial data stays on the device.
- No backend, cloud database, or bank API in the initial version.
- One codebase for iPhone and desktop browsers.
- PWA installable from a secure web origin and usable offline.
- Personal financial data, backups, credentials and encryption keys must never be committed here.

## Structure

`index.html` · `manifest.json` · `service-worker.js` · `css/` · `js/db/` · `js/accounts/` · `js/transactions/` · `js/dashboard/` · `js/import/` · `js/backup/` · `js/security/`

## Kontoauszug-Import (PDF / CSV)

Unter **Transaktionen → Importieren** lassen sich Kontoauszüge als PDF oder CSV laden. Die Dateien werden ausschließlich lokal im Browser gelesen (kein Upload) und nach einer Vorschau in IndexedDB gespeichert.

- `js/import/csv.js` – CSV: Kodierung, Trennzeichen, Kopfzeile/Spalten; Bankprofile in `CSV_PROFILES`
- `js/import/pdf.js` – PDF-Text via pdf.js (lokal in `js/vendor/pdfjs/`, Apache-2.0); Bankprofile in `PDF_PROFILES`
- `js/import/importer.js` – Vorschau, Korrektur, Duplikatprüfung, Speichern/Rückgängig
- `js/transactions/` – einheitliches Transaktionsformat, Betrags-/Datumsparser, Kategorien
- `js/db/`, `js/accounts/` – IndexedDB-Schema und Konten

## Verträge & Anlagen

Der Reiter **Verträge** erkennt aus den importierten Transaktionen regelmäßige Ausgaben (Intervalle 1, 2, 3, 4, 6, 12, 24 Monate) und macht Vorschläge, die bestätigt, bearbeitet oder ignoriert werden. Anlagen (z. B. ETF-Sparplan) werden getrennt von den Vertragskosten ausgewiesen.

- `js/contracts/contracts.js` – Erkennung, Kostenberechnung, Speicherung (IndexedDB-Store `contracts`, DB-Version 2)
- `js/contracts/view.js` – Oberfläche des Reiters

Beim Ändern von App-Dateien die Version in `service-worker.js` erhöhen.
