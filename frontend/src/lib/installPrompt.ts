/**
 * Catches the browser's "install this app" offer the moment it is made.
 *
 * `beforeinstallprompt` fires ONCE, early, and a listener registered later
 * never hears it. The first cut registered inside `UserMenu`'s effect, so the
 * entry appeared only if the menu happened to mount before the browser fired
 * — which on a cold load it does not (review, 2026-09-19). The listener has
 * to exist before React does, which is why this module is imported for its
 * side effect from `main.tsx`, exactly as `lib/maplibreWorker` is.
 *
 * The event is stored rather than acted on: `prompt()` cannot be called
 * without a user gesture, so the offer has to wait for a click that may come
 * minutes later, or never.
 *
 * `BeforeInstallPromptEvent` is Chromium-only and absent from lib.dom, so the
 * two members that are used are declared here and narrowed to, rather than a
 * global type being asserted that does not exist.
 */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof (event as InstallPromptEvent).prompt === "function";
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

function setDeferred(next: InstallPromptEvent | null): void {
  if (deferred === next) return;
  deferred = next;
  announce();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event: Event) => {
    if (!isInstallPromptEvent(event)) return;
    // Without this the browser shows its own bar as well, and the reader gets
    // the same offer twice.
    event.preventDefault();
    setDeferred(event);
  });
  // Once installed the offer is spent — the event never fires again, and a
  // stale one would open a dialog that answers "already installed".
  window.addEventListener("appinstalled", () => setDeferred(null));
}

/** Subscribe to changes; returns the unsubscribe. For `useSyncExternalStore`. */
export function subscribeToInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether there is an offer to make right now. */
export function hasInstallPrompt(): boolean {
  return deferred !== null;
}

/**
 * Shows the browser's own dialog. Must be called from a user gesture.
 *
 * The offer is dropped BEFORE `prompt()` is awaited: one event answers one
 * prompt, and a second call on the same event rejects.
 */
export function showInstallPrompt(): Promise<void> {
  const event = deferred;
  if (!event) return Promise.resolve();
  setDeferred(null);
  return event.prompt();
}

/** Test seam: forget the offer this module is holding. */
export function resetInstallPrompt(): void {
  setDeferred(null);
}
