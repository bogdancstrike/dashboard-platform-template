/**
 * A record edit a change rule held back comes back with `pending_approval`
 * instead of being applied (Time & decisions). Saying "saved" would be a lie;
 * this says where it went.
 */
export interface Held {
  pending_approval?: { reference: string; summary?: string } | null;
}

export function heldMessage(saved: unknown): string | null {
  const held = (saved as Held | null)?.pending_approval;
  if (!held) return null;
  return `Sent for approval as ${held.reference}${held.summary ? ` — ${held.summary}` : ""}. It applies once approved.`;
}
