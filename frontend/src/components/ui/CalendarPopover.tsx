import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";

const POPOVER_WIDTH_PX = 340;
const GAP_PX = 8;

interface CalendarPopoverProps {
  /** The element the popover hangs from (the field), measured when it opens. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Where focus goes back to on Escape. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
}

/**
 * The surface the calendar sits on: a popover under the field on a tablet or
 * desktop, a bottom sheet on a phone-width viewport (the same split as
 * `YearPicker`). Fixed and measured from the field, because a form row that
 * scrolls would clip an absolutely placed one. Outside click and Escape close
 * it; Escape is captured so that, inside a dialog, it does not also close the
 * dialog and drop what the reader entered. Rendered in place, not in a portal,
 * so a dialog's focus trap still sees it as its own. While the year grid inside is open,
 * Escape belongs to that grid first.
 */
export default function CalendarPopover({
  anchorRef,
  onClose,
  returnFocusRef,
  label,
  children,
}: CalendarPopoverProps): JSX.Element {
  const phone = useIsPhoneViewport();
  const ref = useRef<HTMLDivElement>(null);
  const [pos] = useState<{ top: number; left: number } | null>(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      top: rect.bottom + GAP_PX,
      left: Math.max(GAP_PX, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH_PX - GAP_PX)),
    };
  });

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent): void => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (ref.current?.querySelector('[aria-expanded="true"]')) return;
      e.stopPropagation();
      onClose();
      returnFocusRef?.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchorRef, onClose, returnFocusRef]);

  useEffect(() => {
    const target =
      ref.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]') ??
      ref.current?.querySelector<HTMLElement>("button");
    target?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={
        phone
          ? "fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl border p-4"
          : "fixed z-[70] rounded-xl border p-3 shadow-lg"
      }
      style={{
        background: "var(--ts-surface)",
        borderColor: "var(--ts-border)",
        top: phone ? undefined : pos?.top,
        left: phone ? undefined : pos?.left,
        width: phone ? undefined : POPOVER_WIDTH_PX,
        maxHeight: phone ? "80vh" : undefined,
        overflowY: "auto",
      }}
    >
      {children}
    </div>
  );
}
