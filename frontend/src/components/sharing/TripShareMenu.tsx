import { useEffect, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { useTripSharingStore } from "../../store/tripSharingStore";
import type { TripPerson } from "../../types/sharing";
import ShareLinkDialog from "../shareLinks/ShareLinkDialog";
import { Button } from "../ui";
import ShareTripDialog from "./ShareTripDialog";

const ITEMS = ["companions", "link"] as const;
type MenuItem = (typeof ITEMS)[number];

/**
 * The trip head's "Teilen" (spec 2026-10-16, D10): one entry point, two kinds
 * of sharing kept apart in words (D11) — "Mit Mitreisenden (eigene Kopie)"
 * copies the trip into a companion's account, "Öffentlicher Link" is the
 * public, expiring link of forgejo#281. Not for the shared demo account,
 * which is every visitor at once.
 *
 * The people are loaded when the companions entry is picked, so the dialog
 * always opens on the current state. A failed load is said out loud and the
 * menu stays — an empty picker would read as "nobody to share with".
 */
export default function TripShareMenu({ tripId }: { tripId: string }): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const isSharedDemo = useIsDemoAccount();
  const addToast = useToastStore((s) => s.addToast);
  const bump = useTripSharingStore((s) => s.bump);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<MenuItem | null>(null);
  // Tagged with its trip, so a trip change never offers the previous trip's people.
  const [loaded, setLoaded] = useState<{ tripId: string; people: TripPerson[] } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (dialog !== "companions") return;
    let cancelled = false;
    void (async () => {
      try {
        const view = await sharingApi.tripSharing(tripId);
        if (!cancelled) setLoaded({ tripId, people: view.people });
      } catch (error) {
        if (cancelled) return;
        logger.error("Failed to load trip sharing:", error);
        addToast("error", t("sharing:trip.errors.loadFailed"));
        setDialog(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dialog, tripId, addToast, t]);

  if (isSharedDemo) return null;

  const pick = (which: MenuItem) => {
    setOpen(false);
    setLoaded(null);
    setDialog(which);
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      // The trigger is the first button of the root, before the menu.
      rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const at = itemRefs.current.findIndex((el) => el === document.activeElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    itemRefs.current[(at + step + ITEMS.length) % ITEMS.length]?.focus();
  };

  const people = loaded?.tripId === tripId ? loaded.people : null;

  return (
    <div ref={rootRef} className="relative">
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t("sharing:menu.button")}
      </Button>
      {open && (
        <div
          role="menu"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-70 mt-1.5 flex min-w-[260px] flex-col rounded-lg p-2 shadow-xl"
          style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
        >
          {ITEMS.map((which, i) => (
            <button
              key={which}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => pick(which)}
              className="rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--ts-tile)]"
              style={{ color: "var(--ts-text)" }}
            >
              {t(`sharing:menu.${which}`)}
            </button>
          ))}
        </div>
      )}
      {dialog === "link" && (
        <ShareLinkDialog open onClose={() => setDialog(null)} kind="trip" targetId={tripId} />
      )}
      {dialog === "companions" && people && (
        <ShareTripDialog
          open
          onClose={() => setDialog(null)}
          tripId={tripId}
          people={people}
          onShared={() => bump(tripId)}
        />
      )}
    </div>
  );
}
