/** Formatting shared by the records-analytics pages. */

export function money(value: number | null | undefined, currency = "EUR"): string {
  const amount = Number(value ?? 0);
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
  if (Math.abs(amount) >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(amount) >= 10_000) return `${symbol}${Math.round(amount / 1000)}k`;
  return `${symbol}${Math.round(amount).toLocaleString()}`;
}
