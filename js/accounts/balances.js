// Kontostand = eingetragener Kontostand am Stichtag + alle Buchungen NACH dem Stichtag.
// Ohne eingetragenen Kontostand zählt nur die Summe der importierten Buchungen (Startwert 0).
export const hasBalance = (account) => account.startBalance != null;

export function accountBalance(account, transactions) {
  const from = account.balanceDate || "";
  let sum = account.startBalance ?? 0;
  for (const t of transactions) if (t.accountId === account.id && (!from || t.date > from)) sum += t.amount;
  return sum;
}

export function totalBalance(accounts, transactions) {
  return {
    total: accounts.reduce((s, a) => s + accountBalance(a, transactions), 0),
    missing: accounts.filter((a) => !hasBalance(a)).length
  };
}
