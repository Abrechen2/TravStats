import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, JSX, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import { useClickOutside } from "../../hooks/useClickOutside";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravTrackVisible } from "../../hooks/useTravTrackVisible";
import { useTripSharingStore } from "../../store/tripSharingStore";
import type { Trip } from "../../types";
import RemoteTripPeople from "../sharing/RemoteTripPeople";
import { placeMenu } from "../sharing/TripShareMenu";
import { SHARE_ITEMS, useTripShareDialogs } from "../sharing/useTripShareDialogs";
import { useRemoteOfferAvailable } from "../sharing/useRemoteOfferAvailable";
import { useRemoteShareBlock } from "../sharing/useRemoteShareBlock";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { TripExportModal } from "./TripExportModal";
import { useTripSummaryAction } from "./useTripSummaryAction";

interface Entry {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

const MENU_WIDTH = 300;

/**
 * "Mehr" (⋯) in the trip head, beside "Bearbeiten" (owner, 2026-11-20): the
 * actions that are used rarely or once per trip — sharing, export, offering
 * the trip to another server, the AI summary — and, last and red, delete
 * (which still asks first, in the page's confirm).
 *
 * An entry whose feature is off is absent, not greyed: the beta key, the
 * federation switch, TravTrack, the text model and the shared demo account
 * each decide for their own entries, exactly where the old buttons and cards
 * decided. The panel is portaled to the body because the head's card clips
 * its overflow; keyboard: Enter/Space open and focus the first entry, the
 * arrows move, Escape and Tab close and hand focus back to the trigger.
 */
export default function TripMoreMenu({
  trip,
  language,
  onDelete,
  onChanged,
}: {
  trip: Trip;
  /** The reader's UI language; the AI summary is written in it. */
  language: string;
  onDelete: () => void;
  /** The trip changed from the menu (a traveller added, a summary written): reload it. */
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["trips", "sharing", "common"]);
  const coarse = useCoarsePointer();
  const isSharedDemo = useIsDemoAccount();
  const travTrack = useTravTrackVisible();
  const remoteOffer = useRemoteOfferAvailable(trip.id);
  const summary = useTripSummaryAction(trip, language, t, onChanged);
  const bump = useTripSharingStore((s) => s.bump);
  const shareDialogs = useTripShareDialogs(trip.id, onChanged);
  const [open, setOpen] = useState(false);
  const remoteBlock = useRemoteShareBlock(trip.id, open);
  const [exporting, setExporting] = useState(false);
  const [offering, setOffering] = useState(false);
  const [placement, setPlacement] = useState<ReturnType<typeof placeMenu> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The trigger is the root's only button: the panel is portaled away.
  const trigger = (): HTMLButtonElement | null => rootRef.current?.querySelector("button") ?? null;

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
      const rect = trigger()?.getBoundingClientRect();
      if (!rect) return;
      setPlacement(
        placeMenu(rect, panelRef.current?.offsetHeight ?? 0, {
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
    if (open) panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const choose = (action: () => void) => (): void => {
    setOpen(false);
    action();
  };

  const shareEntries: Entry[] = isSharedDemo
    ? []
    : SHARE_ITEMS.filter((which) => which !== "route" || travTrack).map((which) => ({
        key: `share-${which}`,
        label: t(`sharing:menu.${which}`),
        onSelect: choose(() => shareDialogs.pick(which)),
      }));
  const entries: Entry[] = [
    { key: "export", label: t("trips:export.button"), onSelect: choose(() => setExporting(true)) },
    ...(!isSharedDemo && remoteOffer
      ? [
          {
            key: "remote",
            label: t("trips:menu.remote"),
            onSelect: choose(() => setOffering(true)),
          },
        ]
      : []),
    ...(summary.available
      ? [
          {
            key: "summary",
            label: summary.generating
              ? t("trips:menu.summaryBusy")
              : trip.summary
                ? t("trips:menu.summaryAgain")
                : t("trips:menu.summaryNone"),
            disabled: summary.generating,
            onSelect: choose(() => void summary.generate()),
          },
        ]
      : []),
  ];
  const deleteEntry: Entry = {
    key: "delete",
    label: t("common:buttons.delete"),
    danger: true,
    onSelect: choose(onDelete),
  };

  const items = (): HTMLElement[] =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
    );

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      // The portaled panel sits at the end of the document, so Tab would leave
      // the page rather than the menu's neighbourhood: close, and hand focus
      // back to the trigger so the browser's Tab continues from there.
      setOpen(false);
      trigger()?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const list = items();
    const at = list.findIndex((el) => el === document.activeElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? list.length - 1
          : (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    const next = e.relatedTarget;
    if (
      next instanceof Element &&
      !rootRef.current?.contains(next) &&
      !panelRef.current?.contains(next)
    ) {
      setOpen(false);
    }
  };

  const item = (entry: Entry): ReactNode => (
    <button
      key={entry.key}
      type="button"
      role="menuitem"
      disabled={entry.disabled}
      onClick={entry.onSelect}
      className="rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--ts-tile)] disabled:opacity-50"
      style={{
        color: entry.danger ? "var(--ts-bad)" : "var(--ts-text)",
        minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
      }}
    >
      {entry.label}
    </button>
  );

  return (
    <div ref={rootRef} onBlur={onBlur}>
      <Button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("trips:menu.label")}
        data-testid="trip-more-menu"
        icon={<Icon name="ellipsis" size={16} />}
        onClick={() => setOpen((o) => !o)}
      >
        {t("trips:menu.more")}
      </Button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={t("trips:menu.label")}
            onKeyDown={onMenuKey}
            className="fixed z-70 flex flex-col overflow-y-auto rounded-lg p-2 shadow-xl"
            style={{
              // Short screens and big text: the panel scrolls, so "Löschen" stays reachable.
              maxHeight: "calc(100dvh - 32px)",
              ...(placement ?? { left: 16, top: 16, width: MENU_WIDTH }),
              visibility: placement ? "visible" : "hidden",
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
            }}
          >
            {shareEntries.length > 0 && (
              <div role="group" aria-label={t("sharing:menu.button")} className="flex flex-col">
                <span aria-hidden="true" className="t-caption px-2.5 pt-1 pb-0.5">
                  {t("sharing:menu.button")}
                </span>
                {shareEntries.map(item)}
              </div>
            )}
            {entries.map(item)}
            {remoteBlock && (
              <p
                data-testid="remote-share-blocked"
                className="t-caption px-2.5 pt-2"
                style={{ borderTop: "1px solid var(--ts-border)" }}
              >
                {t(`sharing:menu.remoteBlocked.${remoteBlock}`)}
              </p>
            )}
            <div
              role="presentation"
              style={{ borderTop: "1px solid var(--ts-border)", margin: "4px 0" }}
            />
            {item(deleteEntry)}
          </div>,
          document.body
        )}
      {shareDialogs.node}
      {exporting && <TripExportModal tripId={trip.id} onClose={() => setExporting(false)} />}
      {offering && (
        <Dialog
          open
          title={t("trips:menu.remoteTitle")}
          maxWidth={560}
          onClose={() => {
            setOffering(false);
            // The list of people on other servers on the overview reloads on this.
            bump(trip.id);
            onChanged();
          }}
        >
          <RemoteTripPeople tripId={trip.id} bare />
        </Dialog>
      )}
    </div>
  );
}
