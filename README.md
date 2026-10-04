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
