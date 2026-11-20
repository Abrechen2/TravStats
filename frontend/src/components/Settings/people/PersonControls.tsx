import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { useClickOutside } from "../../../hooks/useClickOutside";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { Switch } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { placeMenu } from "../../sharing/TripShareMenu";
import type { PersonEntry } from "./buildPeople";

/** What the row's controls ask the section to do; the section owns every call and its failure. */
export interface PersonHandlers {
  toggleShare: (p: PersonEntry, on: boolean) => void;
  toggleTotals: (p: PersonEntry, on: boolean) => void;
  editTotalsScope: (p: PersonEntry) => void;
  link: (p: PersonEntry) => void;
  rename: (p: PersonEntry) => void;
  merge: (p: PersonEntry) => void;
  remove: (p: PersonEntry) => void;
  endConnection: (p: PersonEntry) => void;
  withdrawPaired: (p: PersonEntry) => void;
  withdrawIncoming: (p: PersonEntry) => void;
  toggleStats: (p: PersonEntry) => void;
  toggleAchievements: (p: PersonEntry) => void;
}

const NS = "sharing:friends";

/** The switches of one person; each is its own consent record and absent when its gate is off. */
export function PersonSwitches({
  person,
  handlers,
  disabled,
  gates,
}: {
  person: PersonEntry;
  handlers: PersonHandlers;
  disabled: boolean;
  gates: { comparison: boolean };
}): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const { account } = person;
  // Without an account there is nothing to switch: "Konto verknüpfen" is the row action.
  if (!account) return null;
  const id = (name: string): string => `person-${person.key}-${name}`;

  const shareOn =
    person.shareConsent !== null
      ? person.shareConsent.status === "accepted" || person.shareConsent.status === "pending"
      : (person.connection?.mine.tripOffers ?? person.paired?.consent === "accepted");
  // A connection that is still a request cannot carry a switch yet.
  const shareLocked =
    account.kind === "remote" && (person.paired !== null || person.connection?.state !== "active");

  const totals = person.comparison?.mine ?? null;
  const totalsOn = totals !== null && (totals.status === "accepted" || totals.status === "pending");
  // The comparison API asks a LOCAL username. A person on another server gets no way to switch it
  // on from here (their bare username would reach a same-named local account); an existing consent
  // can still be switched off, by its key.
  const totalsShown = gates.comparison && (account.kind === "local" || totalsOn);

  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-0"
      data-testid={`person-switches-${person.key}`}
    >
      <Switch
        id={id("share")}
        checked={shareOn}
        disabled={disabled || shareLocked}
        label={t(`${NS}.switches.share.label`)}
        onChange={(on) => handlers.toggleShare(person, on)}
      />
      {totalsShown && (
        <div>
          <Switch
            id={id("totals")}
            checked={totalsOn}
            disabled={disabled}
            label={t(`${NS}.switches.totals.label`)}
            onChange={(on) => handlers.toggleTotals(person, on)}
          />
          {totals?.status === "accepted" && (
            <button
              type="button"
              className="t-caption underline"
              disabled={disabled}
              onClick={() => handlers.editTotalsScope(person)}
            >
              {t(`${NS}.switches.editScope`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface MenuEntry {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * The row's actions behind one "⋯" (the pattern of the trip's "Mehr" menu): link an account,
 * rename, merge, delete for a companion; end the connection, look at their figures for a person on
 * another server. A row with nothing to do has no menu.
 */
export function PersonMenu({
  person,
  handlers,
  disabled,
  canMerge,
  statsOpen,
  achievementsOpen,
}: {
  person: PersonEntry;
  handlers: PersonHandlers;
  disabled: boolean;
  canMerge: boolean;
  statsOpen: boolean;
  achievementsOpen: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["sharing", "companions"]);
  const coarse = useCoarsePointer();
  const { companion, connection, paired, account } = person;
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<ReturnType<typeof placeMenu> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback((e: MouseEvent | TouchEvent) => {
    if (panelRef.current?.contains(e.target as Node)) return;
    setOpen(false);
  }, []);
  useClickOutside(rootRef, close);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const reposition = (): void => {
      const rect = rootRef.current?.querySelector("button")?.getBoundingClientRect();
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

  const entries: MenuEntry[] = [
    ...(companion
      ? [
          {
            key: "link",
            label:
              account?.kind === "local"
                ? t(`${NS}.actions.changeLink`)
                : t(`${NS}.actions.linkAccount`),
            onSelect: () => handlers.link(person),
          },
          {
            key: "rename",
            label: t("companions:manage.actions.rename"),
            onSelect: () => handlers.rename(person),
          },
          {
            key: "merge",
            label: t("companions:manage.actions.merge"),
            disabled: !canMerge,
            onSelect: () => handlers.merge(person),
          },
        ]
      : []),
    ...(connection?.state === "active" && connection.theirs.stats !== "off"
      ? [
          {
            key: "stats",
            label: statsOpen ? t(`${NS}.actions.closeStats`) : t(`${NS}.actions.viewStats`),
            onSelect: () => handlers.toggleStats(person),
          },
        ]
      : []),
    ...(connection?.state === "active" && connection.theirs.achievements
      ? [
          {
            key: "achievements",
            label: achievementsOpen
              ? t(`${NS}.actions.closeAchievements`)
              : t(`${NS}.actions.viewAchievements`),
            onSelect: () => handlers.toggleAchievements(person),
          },
        ]
      : []),
    ...(connection
      ? [
          {
            key: "end",
            label: t(`${NS}.actions.endConnection`),
            danger: true,
            onSelect: () => handlers.endConnection(person),
          },
        ]
      : []),
    ...(paired?.consent === "accepted"
      ? [
          {
            key: "withdraw",
            label: t(`${NS}.actions.withdrawPaired`),
            danger: true,
            onSelect: () => handlers.withdrawPaired(person),
          },
        ]
      : []),
    ...(person.incomingConsent
      ? [
          {
            key: "withdrawIncoming",
            label: t(`${NS}.actions.withdrawIncoming`),
            danger: true,
            onSelect: () => handlers.withdrawIncoming(person),
          },
        ]
      : []),
    ...(companion && !companion.inUse
      ? [
          {
            key: "delete",
            label: t("companions:manage.actions.delete"),
            danger: true,
            onSelect: () => handlers.remove(person),
          },
        ]
      : []),
  ];
  if (entries.length === 0) return null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      rootRef.current?.querySelector("button")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
    );
    const at = list.findIndex((el) => el === document.activeElement);
    list[(at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
  };

  const label = t(`${NS}.menu.label`, { name: person.name });
  return (
    <div ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-testid={`person-menu-${person.key}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center rounded-md"
        style={{
          width: coarse ? 44 : 32,
          height: coarse ? 44 : 32,
          color: "var(--ts-muted)",
        }}
      >
        <Icon name="ellipsis" size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onKeyDown={onKey}
            className="fixed z-70 flex flex-col overflow-y-auto rounded-lg p-2 shadow-xl"
            style={{
              maxHeight: "calc(100dvh - 32px)",
              ...(placement ?? { left: 16, top: 16, width: 220 }),
              visibility: placement ? "visible" : "hidden",
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
            }}
          >
            {entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={() => {
                  setOpen(false);
                  entry.onSelect();
                }}
                className="rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--ts-tile)] disabled:opacity-50"
                style={{
                  color: entry.danger ? "var(--ts-bad)" : "var(--ts-text)",
                  minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
