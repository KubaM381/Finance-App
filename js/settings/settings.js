// Einstellungen: Kontostände (für die Gesamtsumme), App-Sperre und eigene Kategorie-Regeln.
import { listAccounts, maskIban } from "../accounts/accounts.js";
import { accountBalance, hasBalance } from "../accounts/balances.js";
import { listAllTransactions, formatMoney, formatAmountInput, parseAmount } from "../transactions/transactions.js";
import { loadRules, listRules, removeRule } from "../transactions/rules.js";
import { putBatch } from "../db/database.js";
import { todayIso } from "../contracts/contracts.js";
import { el } from "../contracts/view.js";
import * as security from "../security/security.js";

let root = null;
const state = { message: "", error: "" };

const field = (label, control, id) => el("div", { class: "field" }, el("label", { for: id, text: label }), control);
const say = (message, error = "") => { state.message = message; state.error = error; render(); };

/* ---------- Konten ---------- */

async function accountsCard() {
  const [accounts, transactions] = await Promise.all([listAccounts(), listAllTransactions()]);
  if (!accounts.length) {
    return el("div", { class: "card ko-card" }, el("h2", { class: "ko-h", text: "Konten" }),
      el("p", { class: "card-note", text: "Konten entstehen beim Import eines Kontoauszugs. Danach kannst du hier den aktuellen Kontostand eintragen." }));
  }
  const rows = accounts.map((account) => {
    const balance = el("input", { type: "text", inputmode: "decimal", id: `bal-${account.id}`, value: hasBalance(account) ? formatAmountInput(account.startBalance) : "", placeholder: "z. B. 1.234,56", autocomplete: "off" });
    const date = el("input", { type: "date", id: `bd-${account.id}`, value: account.balanceDate || todayIso() });
    const save = el("button", { type: "button", class: "btn", text: "Speichern" });
    save.addEventListener("click", async () => {
      const cents = parseAmount(balance.value);
      if (cents == null || !date.value) return say("", "Bitte Kontostand und Datum angeben.");
      await putBatch({ accounts: [{ ...account, startBalance: cents, balanceDate: date.value }] });
      say(`Kontostand für „${account.name}“ gespeichert.`);
    });
    return el("li", { class: "se-account" },
      el("div", { class: "pl-head" },
        el("span", { class: "ko-item-label", text: `${account.name}${account.iban ? ` (${maskIban(account.iban)})` : ""}` }),
        el("span", { class: "num", text: formatMoney(accountBalance(account, transactions)) })),
      el("div", { class: "pv-editor" }, field("Kontostand (€)", balance, `bal-${account.id}`), field("am Datum", date, `bd-${account.id}`)),
      el("div", { class: "ct-actions" }, save));
  });
  return el("div", { class: "card ko-card" }, el("h2", { class: "ko-h", text: "Konten & Kontostand" }),
    el("p", { class: "card-note", text: "Trage den Kontostand zu einem Datum ein. Buchungen danach werden automatisch dazugerechnet; daraus ergibt sich die Gesamtsumme in der Übersicht." }),
    el("ul", { class: "ko-items" }, ...rows));
}

/* ---------- Sicherheit ---------- */

async function securityCard() {
  const enabled = security.isLockEnabled();
  const pin = el("input", { type: "password", inputmode: "numeric", id: "se-pin", maxlength: "8", autocomplete: "off", placeholder: "4–8 Ziffern" });
  const repeat = el("input", { type: "password", inputmode: "numeric", id: "se-pin2", maxlength: "8", autocomplete: "off" });
  const note = el("p", { class: "card-note", text: "Die Sperre schützt die Oberfläche beim Öffnen und nach der Zeit im Hintergrund. Die gespeicherten Daten werden dadurch noch nicht verschlüsselt." });

  if (!enabled) {
    const save = el("button", { type: "button", class: "btn btn-primary", text: "App-Sperre aktivieren" });
    save.addEventListener("click", async () => {
      if (pin.value !== repeat.value) return say("", "Die beiden PINs stimmen nicht überein.");
      try { await security.setPin(pin.value); say("App-Sperre aktiviert."); } catch (error) { say("", error.message); }
    });
    return el("div", { class: "card ko-card" }, el("h2", { class: "ko-h", text: "App-Sperre" }),
      el("div", { class: "pv-editor" }, field("PIN", pin, "se-pin"), field("PIN wiederholen", repeat, "se-pin2")), el("div", { class: "ct-actions" }, save), note);
  }

  const delay = el("select", { id: "se-delay", "aria-label": "Sperren nach" },
    ...[[0, "Sofort beim Verlassen"], [1, "Nach 1 Minute"], [5, "Nach 5 Minuten"], [15, "Nach 15 Minuten"]].map(([value, text]) => el("option", { value: String(value), text })));
  delay.value = String(security.getLockDelay());
  delay.addEventListener("change", () => { security.setLockDelay(Number(delay.value)); say("Sperrzeit gespeichert."); });

  const parts = [el("h2", { class: "ko-h", text: "App-Sperre aktiv" }), field("Sperren", delay, "se-delay")];
  if (await security.biometricAvailable()) {
    const toggle = el("input", { type: "checkbox", id: "se-bio", checked: security.hasBiometric() });
    toggle.addEventListener("change", async () => {
      try {
        if (toggle.checked) await security.enableBiometric(); else security.disableBiometric();
        say(toggle.checked ? "Biometrische Entsperrung aktiviert." : "Biometrische Entsperrung deaktiviert.");
      } catch { say("", "Biometrie konnte nicht eingerichtet werden."); }
    });
    parts.push(el("label", { class: "pv-filter", for: "se-bio" }, toggle, el("span", { text: "Mit Face ID / Touch ID / Fingerabdruck entsperren" })));
  }
  const current = el("input", { type: "password", inputmode: "numeric", id: "se-cur", maxlength: "8", autocomplete: "off" });
  const remove = el("button", { type: "button", class: "btn ct-danger", text: "Sperre entfernen" });
  remove.addEventListener("click", async () => {
    if (!(await security.verifyPin(current.value))) return say("", "Falsche PIN.");
    security.removeLock();
    say("App-Sperre entfernt.");
  });
  parts.push(field("Aktuelle PIN (zum Entfernen)", current, "se-cur"), el("div", { class: "ct-actions" }, remove), note);
  return el("div", { class: "card ko-card" }, ...parts);
}

/* ---------- Kategorie-Regeln ---------- */

function rulesCard() {
  const rules = listRules();
  return el("div", { class: "card ko-card" }, el("h2", { class: "ko-h", text: "Eigene Kategorie-Regeln" }),
    el("p", { class: "card-note", text: "Entstehen, wenn du bei einer Buchung in „Transaktionen“ die Kategorie änderst und „Für alle ähnlichen Buchungen merken“ aktiv lässt." }),
    rules.length
      ? el("ul", { class: "ko-items" }, ...rules.map((rule) => {
          const del = el("button", { type: "button", class: "link ct-del", text: "Löschen" });
          del.addEventListener("click", async () => { await removeRule(rule.id); say("Regel gelöscht (bereits geänderte Buchungen bleiben unverändert)."); });
          return el("li", { class: "ko-item" }, el("div", { class: "ko-item-main" }, el("span", { class: "ko-item-label", text: rule.key }), el("span", { class: "ko-tags", text: `→ ${rule.category}` })), del);
        }))
      : el("p", { class: "card-note", text: "Noch keine Regeln." }));
}

async function render() {
  try {
    await loadRules();
    root.replaceChildren(
      state.message ? el("div", { class: "notice" }, el("span", { text: state.message })) : null,
      state.error ? el("div", { class: "notice error" }, el("span", { text: state.error })) : null,
      await accountsCard(), await securityCard(), rulesCard());
  } catch (error) {
    root.replaceChildren(el("div", { class: "notice error", text: `Einstellungen konnten nicht geladen werden: ${error?.message || error}` }));
  }
}

export function initSettings() {
  root = document.getElementById("se-body");
  if (!root) return;
  const onNavigate = () => { if (location.hash === "#einstellungen") { state.message = ""; state.error = ""; render(); } };
  window.addEventListener("hashchange", onNavigate);
  onNavigate();
}
