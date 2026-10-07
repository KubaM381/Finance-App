// Budgets (Monatslimit pro Kategorie) und Sparziele. Alles lokal in IndexedDB (Stores "budgets" und "goals").
import { getAll, putBatch, deleteRecord, newId } from "../db/database.js";
import { formatMoney, formatDate, formatAmountInput, parseAmount, parseDate } from "../transactions/transactions.js";
import { CATEGORY_NAMES } from "../transactions/categories.js";
import { monthsBetween, todayIso } from "../contracts/contracts.js";
import { el } from "../contracts/view.js";

export const listBudgets = () => getAll("budgets");
export const listGoals = () => getAll("goals");

const INCOME_ONLY = new Set(["Gehalt", "Erstattung", "Zinsen & Erträge", "Sonstige Einnahmen"]);
const EXPENSE_CATEGORIES = CATEGORY_NAMES.filter((name) => !INCOME_ONLY.has(name));
const form = { budgetId: null, goalId: null, error: "" };

/* ---------- Budgets ---------- */

// Ausgaben pro Kategorie im Monat gegen das Limit rechnen. ratio ≥ 0,8 = Warnung, ≥ 1 = überschritten.
export function budgetStatus(budgets, transactions, ym) {
  const spent = new Map();
  for (const t of transactions) {
    if (t.amount < 0 && t.date.startsWith(ym)) spent.set(t.category, (spent.get(t.category) || 0) - t.amount);
  }
  return budgets
    .map((b) => { const s = spent.get(b.category) || 0; return { ...b, spent: s, ratio: b.limit ? s / b.limit : 0 }; })
    .sort((a, b) => b.ratio - a.ratio);
}

const level = (ratio) => (ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok");
const field = (label, control, id) => el("div", { class: "field" }, el("label", { for: id, text: label }), control);
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

function bar(ratio, kind) {
  const fill = el("span", { class: `bar-fill b-${kind}` });
  fill.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
  return el("div", { class: "bar", role: "img", "aria-label": `${Math.round(ratio * 100)} Prozent` }, fill);
}

export async function renderBudgets(container, { transactions, ym }, reload) {
  const budgets = await listBudgets();
  const rows = budgetStatus(budgets, transactions, ym);
  const editing = budgets.find((b) => b.id === form.budgetId);

  const category = el("select", { id: "bu-cat" }, ...EXPENSE_CATEGORIES.map((name) => el("option", { value: name, text: name })));
  category.value = editing?.category || EXPENSE_CATEGORIES[0];
  const limit = el("input", { type: "text", inputmode: "decimal", id: "bu-limit", value: editing ? formatAmountInput(editing.limit) : "", autocomplete: "off", placeholder: "z. B. 300,00" });

  const add = el("div", { class: "card pl-form" },
    el("h2", { class: "ko-h", text: editing ? "Budget ändern" : "Neues Budget" }),
    el("div", { class: "pv-editor" }, field("Kategorie", category, "bu-cat"), field("Monatslimit (€)", limit, "bu-limit")),
    form.error ? el("p", { class: "ct-warn", text: form.error }) : null,
    el("div", { class: "ct-actions" },
      el("button", { type: "button", class: "btn btn-primary", text: editing ? "Speichern" : "Hinzufügen" }),
      editing ? el("button", { type: "button", class: "btn", "data-act": "bu-cancel", text: "Abbrechen" }) : null));
  add.querySelector(".btn-primary").addEventListener("click", async () => {
    const cents = Math.abs(parseAmount(limit.value) ?? 0);
    if (!cents) { form.error = "Bitte ein Limit größer 0 eingeben."; return reload(); }
    const existing = budgets.find((b) => b.category === category.value);
    await putBatch({ budgets: [{ id: existing?.id || newId(), category: category.value, limit: cents }] });
    Object.assign(form, { budgetId: null, error: "" });
    reload();
  });
  add.querySelector('[data-act="bu-cancel"]')?.addEventListener("click", () => { Object.assign(form, { budgetId: null, error: "" }); reload(); });

  const list = rows.length
    ? el("div", { class: "card ko-card" }, el("ul", { class: "ko-items pl-list" }, ...rows.map((b) => {
        const lv = level(b.ratio);
        const left = b.limit - b.spent;
        const note = lv === "over" ? `${formatMoney(-left)} über dem Limit` : `noch ${formatMoney(left)} frei`;
        const li = el("li", { class: "pl-item" },
          el("div", { class: "pl-head" },
            el("span", { class: "ko-item-label", text: b.category }),
            el("span", { class: `num pl-${lv}`, text: `${formatMoney(b.spent)} von ${formatMoney(b.limit)}` })),
          bar(b.ratio, lv),
          el("div", { class: "pl-head" },
            el("span", { class: `card-note pl-${lv}`, text: lv === "warn" ? `Achtung, ${Math.round(b.ratio * 100)} % verbraucht · ${note}` : note }),
            el("span", {}, el("button", { type: "button", class: "link", "data-edit": b.id, text: "Ändern" }), " ",
              el("button", { type: "button", class: "link ct-del", "data-del": b.id, text: "Löschen" }))));
        li.querySelector("[data-edit]").addEventListener("click", () => { form.budgetId = b.id; reload(); });
        li.querySelector("[data-del]").addEventListener("click", async () => { await deleteRecord("budgets", b.id); reload(); });
        return li;
      })))
    : el("div", { class: "card empty" }, el("h2", { text: "Noch keine Budgets" }), el("p", { text: "Lege ein Monatslimit pro Kategorie fest, z. B. für Lebensmittel oder Freizeit." }));

  container.replaceChildren(
    el("p", { class: "card-note ct-hint", text: `Verbrauch im ${monthLabel(ym)} (neuester Monat mit Buchungen). Warnung ab 80 %.` }),
    list, add);
}

/* ---------- Sparziele ---------- */

export async function renderGoals(container, _data, reload) {
  const goals = await listGoals();
  const today = todayIso();
  const editing = goals.find((g) => g.id === form.goalId);

  const name = el("input", { type: "text", id: "go-name", value: editing?.name || "", maxlength: "60", autocomplete: "off", placeholder: "z. B. Urlaub" });
  const target = el("input", { type: "text", inputmode: "decimal", id: "go-target", value: editing ? formatAmountInput(editing.target) : "", autocomplete: "off" });
  const saved = el("input", { type: "text", inputmode: "decimal", id: "go-saved", value: editing ? formatAmountInput(editing.saved) : "0,00", autocomplete: "off" });
  const date = el("input", { type: "date", id: "go-date", value: editing?.targetDate || "" });

  const add = el("div", { class: "card pl-form" },
    el("h2", { class: "ko-h", text: editing ? "Sparziel ändern" : "Neues Sparziel" }),
    el("div", { class: "pv-editor" },
      field("Name", name, "go-name"), field("Zielbetrag (€)", target, "go-target"),
      field("Bereits gespart (€)", saved, "go-saved"), field("Zieldatum (optional)", date, "go-date")),
    form.error ? el("p", { class: "ct-warn", text: form.error }) : null,
    el("div", { class: "ct-actions" },
      el("button", { type: "button", class: "btn btn-primary", text: editing ? "Speichern" : "Hinzufügen" }),
      editing ? el("button", { type: "button", class: "btn", "data-act": "go-cancel", text: "Abbrechen" }) : null));
  add.querySelector(".btn-primary").addEventListener("click", async () => {
    const targetCents = Math.abs(parseAmount(target.value) ?? 0);
    const savedCents = Math.abs(parseAmount(saved.value) ?? 0);
    const targetDate = date.value ? parseDate(date.value) : null;
    if (!name.value.trim()) form.error = "Bitte einen Namen eingeben.";
    else if (!targetCents) form.error = "Bitte einen Zielbetrag größer 0 eingeben.";
    else form.error = "";
    if (form.error) return reload();
    await putBatch({ goals: [{ id: editing?.id || newId(), name: name.value.trim(), target: targetCents, saved: savedCents, targetDate }] });
    Object.assign(form, { goalId: null, error: "" });
    reload();
  });
  add.querySelector('[data-act="go-cancel"]')?.addEventListener("click", () => { Object.assign(form, { goalId: null, error: "" }); reload(); });

  const list = goals.length
    ? el("div", { class: "ct-cards" }, ...goals.map((g) => {
        const ratio = g.target ? g.saved / g.target : 0;
        const rest = Math.max(0, g.target - g.saved);
        let note = rest ? `Noch ${formatMoney(rest)}` : "Ziel erreicht 🎉";
        if (rest && g.targetDate) {
          const months = Math.max(1, Math.ceil(monthsBetween(today, g.targetDate)));
          note += g.targetDate < today ? ` · Zieldatum ${formatDate(g.targetDate)} überschritten` : ` · ca. ${formatMoney(Math.ceil(rest / months))} pro Monat bis ${formatDate(g.targetDate)}`;
        }
        const card = el("article", { class: "card ct-card" },
          el("div", { class: "section-head" }, el("h2", { class: "ct-name", text: g.name }), el("span", { class: "chip", text: `${Math.min(100, Math.round(ratio * 100))} %` })),
          bar(Math.min(1, ratio), ratio >= 1 ? "ok" : "goal"),
          el("p", { class: "tx-meta num", text: `${formatMoney(g.saved)} von ${formatMoney(g.target)}` }),
          el("p", { class: "tx-meta", text: note }),
          el("div", { class: "ct-actions" },
            el("button", { type: "button", class: "btn", "data-edit": "1", text: "Bearbeiten" }),
            el("button", { type: "button", class: "btn ct-danger", "data-del": "1", text: "Löschen" })));
        card.querySelector("[data-edit]").addEventListener("click", () => { form.goalId = g.id; reload(); });
        card.querySelector("[data-del]").addEventListener("click", async () => { await deleteRecord("goals", g.id); reload(); });
        return card;
      }))
    : el("div", { class: "card empty" }, el("h2", { text: "Noch keine Sparziele" }), el("p", { text: "Lege ein Ziel mit Betrag und optionalem Datum an – die App rechnet den monatlichen Bedarf aus." }));

  container.replaceChildren(list, add);
}
