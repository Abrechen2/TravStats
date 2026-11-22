import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, JSX, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { useClickOutside } from "../../hooks/useClickOutside";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { placeMenu } from "../sharing/TripShareMenu";
import Button from "./Button";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./Icon";

export interface OverflowEntry {
  key: string;
  label: string;
  /** A muted sentence under the label: what the entry does, where that is not obvious. */
  hint?: string;
  /** `data-testid` of the entry (it exists only while the menu is open). */
  testId?: string;
  /** Runs when the entry is chosen (after the confirmation, when `confirm` is set). */
  onSelect?: () => void;
  /** Navigates instead of calling `onSelect`. */
  href?: string;
  disabled?: boolean;
  /** Shown under a disabled entry, so a greyed row explains itself. */
  disabledReason?: string;
  /** Red, and sorted after every other entry. */
  danger?: boolean;
  /**
   * Ask first, in the shared confirm dialog. Leave it out where the caller
   * already owns a confirmation (the detail pages' delete dialogs).
   */
  confirm?: { title: string; message: string; confirmText?: string };
}

/**
 * The one "Mehr" / "⋯" menu.
 *
 * Consistency rule (owner, 2026-11-22): rare and destructive actions live in a
 * ⋯ at the right of the header; a row with more than two actions gets a row
 * ⋯; delete is always the last entry, red, and confirmed. An entry whose
 * feature is off is left out, not greyed; one that is only unavailable right
 * now is disabled and says why (`disabledReason`).
 *
 * Extracted from the trip head's menu (which had the keyboard handling and the
 * touch sizing right) so six hand-rolled copies stop drifting. The panel is
 * portaled to the body because headers and cards clip their overflow.
 * Keyboard: Enter/Space open and focus the first entry, the arrows/Home/End
 * move, Escape and Tab close and hand focus back to the trigger. Targets are
 * 44 px on a coarse pointer (an iPad at any width).
 */
/**
 * An entry that opens a dialog of its own: the dialog hands focus back to the element that
 * opened it — the menu entry, which is gone by then — so focus fell to the page. Watch for the
 * dialog to appear and go, and give focus back to the trigger once it has (package 1, P3).
 * Entries that open nothing leave no dialog behind and cost one observer for a moment.
 */
function returnFocusAfterDialog(trigger: () => HTMLButtonElement | null): void {
  const DIALOG = '[role="dialog"],[aria-modal="true"]';
  let seen = false;
  const observer = new MutationObserver(() => {
    const present = document.querySelector(DIALOG) !== null;
    if (present) {
      seen = true;
      return;
    }
    if (seen) {
      observer.disconnect();
      window.clearTimeout(giveUp);
      const active = document.activeElement;
      if (!active || active === document.body) trigger()?.focus();
    }
  });
  // No dialog within a second: the entry did something else (navigated, downloaded).
  const giveUp = window.setTimeout(() => {
    if (!seen) observer.disconnect();
  }, 1000);
  observer.observe(document.body, { childList: true, subtree: true });
}

export default function OverflowMenu({
  entries,
  label,
  triggerLabel,
  testId,
  disabled,
  stopPropagation,
  children,
}: {
  entries: OverflowEntry[];
  /** Accessible name of the trigger and the menu. */
  label: string;
  /** Visible text beside the ⋯ ("Mehr"); without it the trigger is the bare icon (rows, cards). */
  triggerLabel?: string;
  testId?: string;
  disabled?: boolean;
  /** Inside a clickable row: keep the click from reaching it. */
  stopPropagation?: boolean;
  /** Dialogs the entries open; they render beside the trigger and survive the menu closing. */
  children?: ReactNode;
}): JSX.Element | null {
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<OverflowEntry | null>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof placeMenu> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
    if (open) {
      panelRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled):not([aria-disabled="true"])')
        ?.focus();
    }
  }, [open]);

  // Stable partition: destructive entries last, in their given order.
  const ordered = [...entries.filter((e) => !e.danger), ...entries.filter((e) => e.danger)];
  const firstDanger = ordered.findIndex((e) => e.danger);
  if (ordered.length === 0) return null;

  const choose = (entry: OverflowEntry): void => {
    setOpen(false);
    if (entry.confirm) {
      setAsking(entry);
      return;
    }
    entry.onSelect?.();
    returnFocusAfterDialog(trigger);
  };

  const items = (): HTMLElement[] =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])'
      ) ?? []
    );

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape" || e.key === "Tab") {
      // Escape closes the menu only: an enclosing dialog's own Escape handler must not also fire.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      // The portaled panel sits at the end of the document: close and hand focus
      // back to the trigger so Tab continues from there.
      setOpen(false);
      trigger()?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const list = items();
    if (list.length === 0) return;
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

  const itemClass =
    "block rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--ts-tile)] aria-disabled:opacity-50 disabled:opacity-50";
  const itemStyle = (entry: OverflowEntry) => ({
    color: entry.danger ? "var(--ts-bad)" : "var(--ts-text)",
    minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
  });

  const hintOf = (entry: OverflowEntry): ReactNode =>
    entry.hint ? (
      <span className="block text-xs font-normal" style={{ color: "var(--ts-muted)" }}>
        {entry.hint}
      </span>
    ) : null;

  const renderItem = (entry: OverflowEntry, index: number): ReactNode => (
    <div key={entry.key} className="flex flex-col">
      {index === firstDanger && index > 0 && (
        <div
          role="presentation"
          style={{ borderTop: "1px solid var(--ts-border)", margin: "4px 0" }}
        />
      )}
      {entry.href && !entry.disabled ? (
        <Link
          to={entry.href}
          role="menuitem"
          data-testid={entry.testId}
          className={itemClass}
          style={itemStyle(entry)}
          onClick={() => setOpen(false)}
        >
          {entry.label}
          {hintOf(entry)}
        </Link>
      ) : (
        <button
          type="button"
          role="menuitem"
          data-testid={entry.testId}
          disabled={entry.disabled}
          title={entry.disabled ? entry.disabledReason : undefined}
          aria-describedby={
            entry.disabled && entry.disabledReason ? `overflow-why-${entry.key}` : undefined
          }
          onClick={() => choose(entry)}
          className={itemClass}
          style={itemStyle(entry)}
        >
          {entry.label}
          {hintOf(entry)}
        </button>
      )}
      {entry.disabled && entry.disabledReason && (
        <span
          id={`overflow-why-${entry.key}`}
          className="px-2.5 pb-1 text-xs"
          style={{ color: "var(--ts-muted)" }}
        >
          {entry.disabledReason}
        </span>
      )}
    </div>
  );

  const stop = stopPropagation
    ? (e: { stopPropagation: () => void }) => e.stopPropagation()
    : undefined;
  // The portaled panel's keys bubble through the React tree into the row (which opens on Enter).
  const stopKeys = stopPropagation
    ? (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }
    : undefined;

  return (
    <div ref={rootRef} onBlur={onBlur} onClick={stop} onKeyDown={stopKeys}>
      {triggerLabel ? (
        <Button
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          data-testid={testId}
          disabled={disabled}
          icon={<Icon name="ellipsis" size={16} />}
          onClick={() => setOpen((o) => !o)}
        >
          {triggerLabel}
        </Button>
      ) : (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          data-testid={testId}
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
      )}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onKeyDown={(e) => {
              stopKeys?.(e);
              onMenuKey(e);
            }}
            onClick={stop}
            className="fixed z-70 flex flex-col overflow-y-auto rounded-lg p-2 shadow-xl"
            style={{
              // Short screens and big text: the panel scrolls, so the last entry stays reachable.
              maxHeight: "calc(100dvh - 32px)",
              ...(placement ?? { left: 16, top: 16, width: 300 }),
              visibility: placement ? "visible" : "hidden",
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
            }}
          >
            {ordered.map(renderItem)}
          </div>,
          document.body
        )}
      {asking?.confirm && (
        <ConfirmModal
          isOpen
          title={asking.confirm.title}
          message={asking.confirm.message}
          confirmText={asking.confirm.confirmText}
          confirmButtonClass={asking.danger ? "btn-danger" : "btn-primary"}
          onClose={() => {
            setAsking(null);
            trigger()?.focus();
          }}
          onConfirm={() => {
            const entry = asking;
            setAsking(null);
            entry.onSelect?.();
          }}
        />
      )}
      {children}
    </div>
  );
}
