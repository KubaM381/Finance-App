// Konten: Anlegen, IBAN-Erkennung und Zuordnung.
import { getAll, newId } from "../db/database.js";

export const listAccounts = () => getAll("accounts");

export const normalizeIban = (value) => String(value || "").replace(/\s+/g, "").toUpperCase();

export const createAccount = ({ name, iban = "", currency = "EUR" }) => ({
  id: newId(),
  name: String(name || "").trim() || "Konto",
  iban: iban ? normalizeIban(iban) : "",
  currency,
  createdAt: new Date().toISOString()
});

// Prüfziffer nach ISO 13616 (Modulo 97).
export function isValidIban(value) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

// Sucht die erste gültige IBAN in einem Text (auch mit Leerzeichen gruppiert).
export function findIban(text) {
  const matches = String(text || "").toUpperCase().match(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g) || [];
  for (const match of matches) {
    const compact = match.replace(/ /g, "");
    for (let length = Math.min(34, compact.length); length >= 15; length--) {
      if (isValidIban(compact.slice(0, length))) return compact.slice(0, length);
    }
  }
  return "";
}

export const maskIban = (iban) => (iban ? `${iban.slice(0, 4)} … ${iban.slice(-4)}` : "");

export const suggestAccountName = (iban) => (iban ? `Konto ${iban.slice(-4)}` : "Girokonto");

export const matchAccountByIban = (accounts, iban) =>
  iban ? accounts.find((account) => account.iban && account.iban === normalizeIban(iban)) || null : null;
