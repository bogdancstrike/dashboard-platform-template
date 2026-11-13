/** How the console says counts and enums. */

export const formatCount = (count: number) => (count === 1 ? "once" : `${count} times`);

/** `WAITING_CUSTOMER` → `Waiting customer`. An enum is not a sentence. */
export function titleCase(value: string): string {
  if (!value) return "";
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

