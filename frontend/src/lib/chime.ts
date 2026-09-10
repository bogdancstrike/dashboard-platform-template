/**
 * The sound a notification makes, when the reader has asked for one (§17, §40).
 *
 * Synthesised rather than fetched: there is no audio file to ship, cache or
 * 404, and no request at the moment somebody is being notified.
 *
 * **The context is created once and resumed on demand.** Browsers refuse an
 * `AudioContext` until the page has been interacted with, and one created
 * before that first click stays `suspended` for the rest of the session — so
 * the first version of this made no sound at all on a page the reader had not
 * yet clicked, which is most of them. Resuming is idempotent and cheap; a
 * context per tone is not.
 *
 * Everything is wrapped: a browser that will not make a noise is not an error
 * worth reporting, and a notification that throws while trying to is a
 * notification nobody sees.
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (context) return context;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/** A short two-note tone. Quiet, and faded rather than cut — a hard stop clicks. */
export function chime(): void {
  const ctx = audio();
  if (!ctx) return;
  try {
    // Suspended is the normal state before the page has been clicked, and
    // `resume` is a promise nothing here needs to wait on: if it lands in
    // time the tone plays, and if it does not the reader hears the next one.
    if (ctx.state === "suspended") void ctx.resume();

    const start = ctx.currentTime;
    // Two notes rather than one, a fifth apart: a single sine at this length
    // reads as a system beep, and two read as a notification.
    for (const [index, frequency] of [880, 1318.5].entries()) {
      const at = start + index * 0.09;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.07, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.18);
    }
  } catch {
    // As above: silence is an acceptable outcome, an exception is not.
  }
}
