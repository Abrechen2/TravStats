import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, JSX, KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { useClickOutside } from "../../hooks/useClickOutside";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { useTripSharingStore } from "../../store/tripSharingStore";
import type { SharePerson, TripPerson } from "../../types/sharing";
import ShareLinkDialog from "../shareLinks/ShareLinkDialog";
import { Button } from "../ui";
import ShareTripDialog from "./ShareTripDialog";
import ShareRouteDialog from "./ShareRouteDialog";
import { useTravTrackVisible } from "../../hooks/useTravTrackVisible";

const ITEMS = ["companions", "link", "route"] as const;
type MenuItem = (typeof ITEMS)[number];

/** Menu width, the gap to the trigger and the margin kept to the viewport edge. */
const MENU_WIDTH = 260;
const GAP = 6;
const GUTTER = 16;

interface Anchor {
  top: number;
  bottom: number;
  right: number;
}

/**
 * Where the panel goes (`position: fixed`, viewport coordinates): right edge
 * aligned to the trigger's, below it — above when there is no room below and
 * more above — and clamped inside the viewport with a gutter, so a trigger
 * near the left edge of a phone never pushes it off-screen. Pure, so it is
 * tested without a layout engine.
 */
export function placeMenu(
  anchor: Anchor,
  panelHeight: number,
  viewport: { width: number; height: number }
): { left: number; top: number; width: number } {
  const width = Math.min(MENU_WIDTH, viewport.width - 2 * GUTTER);
  const left = Math.max(GUTTER, Math.min(anchor.right - width, viewport.width - width - GUTTER));
  const below = anchor.bottom + GAP;
  const fitsBelow = below + panelHeight <= viewport.height - GUTTER;
  const top =
    fitsBelow || anchor.top < viewport.height / 2 ? below : anchor.top - GAP - panelHeight;
  return { left, top: Math.max(GUTTER, top), width };
}

/**
 * The trip head's "Teilen" (spec 2026-10-16, D10): one entry point, two kinds
 * of sharing kept apart in words (D11) — "Mit Mitreisenden (eigene Kopie)"
 * copies the trip into a companion's account, "Öffentlicher Link" is the
 * public, expiring link of forgejo#281. Where TravTrack is offered, a third
 * entry shares the trip's recorded route as a snapshot (TravTrack plan T7,
 * `ShareRouteDialog`). Not for the shared demo account,
 * which is every visitor at once.
 *
 * The panel is portaled to the body: the head's hero card clips its overflow
 * (the cover image needs that), which would cut an inline dropdown off.
 *
 * The people are loaded when the companions entry is picked, so the dialog
 * always opens on the current state. A failed load is said out loud and the
 * menu stays — an empty picker would read as "nobody to share with".
 */
export default function TripShareMenu({
  tripId,
  onChanged,
}: {
  tripId: string;
  /**
   * The trip itself changed (a traveller was added from the dialog): the page
   * reloads it, or its companion list goes stale and the next save of the trip
   * form — a full-list PATCH — drops the new traveller.
   */
  onChanged?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const isSharedDemo = useIsDemoAccount();
  const addToast = useToastStore((s) => s.addToast);
  const bump = useTripSharingStore((s) => s.bump);
  // The route entry only where TravTrack is offered to this account.
  const travTrack = useTravTrackVisible();
  const items = ITEMS.filter((which) => which !== "route" || travTrack);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<MenuItem | null>(null);
  // Tagged with its trip, so a trip change never offers the previous trip's people.
  const [loaded, setLoaded] = useState<{
    tripId: string;
    people: TripPerson[];
    linkableUsers: SharePerson[];
  } | null>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof placeMenu> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // The panel lives in a portal, so "inside" means the trigger's root OR the panel.
  const closeOnOutside = useCallback((e: MouseEvent | TouchEvent) => {
    if (panelRef.current?.contains(e.target as Node)) return;
    setOpen(false);
  }, []);
  useClickOutside(rootRef, closeOnOutside);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const reposition = (): void => {
      const trigger = rootRef.current?.querySelector("button")?.getBoundingClientRect();
      if (!trigger) return;
      // A trigger scrolled fully out of sight leaves the panel nothing to hang
      // from: close rather than float it over unrelated content. A rect with no
      // size is a trigger without layout (not rendered), not one scrolled away.
      const hasLayout = trigger.width > 0 || trigger.height > 0;
      if (
        hasLayout &&
        (trigger.bottom <= 0 ||
          trigger.top >= window.innerHeight ||
          trigger.right <= 0 ||
          trigger.left >= window.innerWidth)
      ) {
        setOpen(false);
        return;
      }
      setPlacement(
        placeMenu(trigger, panelRef.current?.offsetHeight ?? 0, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      );
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (dialog !== "companions") return;
    let cancelled = false;
    void (async () => {
      try {
        const view = await sharingApi.tripSharing(tripId);
        if (!cancelled) {
          setLoaded({ tripId, people: view.people, linkableUsers: view.linkableUsers });
        }
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

  // Tabbing out of trigger and panel closes the menu; a target that is not an
  // element (a click on nothing focusable) is the outside-click hook's business.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (
      next instanceof Element &&
      !rootRef.current?.contains(next) &&
      !panelRef.current?.contains(next)
    ) {
      setOpen(false);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      // The trigger is the root's only button while the panel is portaled away.
      rootRef.current?.querySelector("button")?.focus();
      return;
    }
    if (e.key === "Tab") {
      // The portaled panel sits at the end of the document, so Tab would leave
      // the page rather than the menu's neighbourhood: close, and hand focus
      // back to the trigger so the browser's Tab continues from there.
      setOpen(false);
      rootRef.current?.querySelector("button")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const at = itemRefs.current.findIndex((el) => el === document.activeElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    itemRefs.current[(at + step + items.length) % items.length]?.focus();
  };

  const current = loaded?.tripId === tripId ? loaded : null;
  const people = current?.people ?? null;
  // Between the pick and the people arriving nothing else is on screen: the
  // trigger says so, and is not a second way in while the first is loading.
  const loading = dialog === "companions" && !people;

  return (
    <div ref={rootRef} onBlur={onBlur}>
      <Button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={loading}
        disabled={loading}
        onClick={() => setOpen((o) => !o)}
      >
        {loading ? t("sharing:menu.loading") : t("sharing:menu.button")}
      </Button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            onKeyDown={onMenuKey}
            onBlur={onBlur}
            className="fixed z-70 flex flex-col rounded-lg p-2 shadow-xl"
            style={{
              ...(placement ?? { left: GUTTER, top: GUTTER, width: MENU_WIDTH }),
              visibility: placement ? "visible" : "hidden",
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
            }}
          >
            {items.map((which, i) => (
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
          </div>,
          document.body
        )}
      {dialog === "route" && (
        <ShareRouteDialog open onClose={() => setDialog(null)} tripId={tripId} />
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
          linkableUsers={current?.linkableUsers ?? []}
          onShared={() => bump(tripId)}
          onPeopleChanged={() => {
            bump(tripId);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
