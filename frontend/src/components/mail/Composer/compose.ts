import { type MailThread } from "@/api/mail";

export interface FormValues {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  priority: string;
}

/**
 * Which placeholders a body still carries.
 *
 * Pure and exported. The server answers this for a *template*; this answers it
 * for whatever is in the box now, because somebody can paste a template's text
 * and edit around the placeholders — and "you are about to send `{{ name }}`
 * to a customer" is worth saying at the moment they press Send.
 */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((hit) => hit[1]!))];
}

/** What a reply's subject and recipients start as. */
export function replyDefaults(thread: MailThread, meEmail: string | null): Partial<FormValues> {
  const messages = thread.messages ?? [];
  const last = messages[messages.length - 1];
  const from = last?.from.email;
  return {
    subject: thread.subject.startsWith("Re: ") ? thread.subject : `Re: ${thread.subject}`,
    // Whoever wrote the last message, and never the reader themselves: a reply
    // addressed back to yourself is the commonest thing a composer gets wrong.
    to: from && from.toLowerCase() !== (meEmail ?? "").toLowerCase() ? [from] : [],
    priority: "NORMAL",
  };
}
