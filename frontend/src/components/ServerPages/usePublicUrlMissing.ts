import { useEffect } from "react";
import { useInstanceStore } from "./instanceStore";

/**
 * True while the server has no public address (B15): invitations, mails and
 * calendars then point at localhost. Only an admin asks — the setting is the
 * server's — and a failed load says nothing, because "I could not read it" is
 * not "it is missing".
 */
export function usePublicUrlMissing(isAdmin: boolean): boolean {
  const settings = useInstanceStore((s) => s.settings);
  const ensureLoaded = useInstanceStore((s) => s.ensureLoaded);
  useEffect(() => {
    if (isAdmin) void ensureLoaded();
  }, [isAdmin, ensureLoaded]);
  return isAdmin && settings !== null && !(settings.frontendUrl ?? "").trim();
}
