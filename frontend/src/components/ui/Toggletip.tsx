import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { placeToggletip, type ToggletipSide } from "./toggletipPosition";

export interface ToggletipProps {
  /** The help itself: what the thing is, in a sentence. */
  content: ReactNode;
  /** The longer explanation, shown once the help is opened. */
  expandedContent?: ReactNode;
  position?: ToggletipSide;
  /**
   * What the help is about, e.g. the field's label. It names the trigger —
   * "Hilfe zu Gepäck" rather than the twelfth "Hilfe anzeigen" in a form, which
   * a screen-reader user cannot tell apart from the other eleven.
   */
  subject?: string;
  /**
   * A trigger of the caller's own — a badge, a dash, a value — instead of the
   * "?" glyph. It is the button's visible text, so it is also its name unless
   * `label` says otherwise.
   */
  children?: ReactNode;
  /**
   * The trigger's accessible name when its visible content says nothing a
   * screen reader can use ("—", an icon). Should contain the visible text.
   */
  label?: string;
  /** Classes for the wrapper around the trigger. */
  className?: string;
  /** Classes for the trigger button (custom-trigger form only). */
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  "data-testid"?: string;
}

/** WCAG 2.5.8's minimum for a mouse; the coarse pointer gets the touch token. */
const FINE_HIT = "24px";

/**
 * The one accessible help affordance (forgejo issue 249): a toggletip.
 *
 * Measured before it existed: essential explanations lived in 60-odd hover
 * `title`s across all eight domains — invisible on the iPads the web build is
 * drawn for, unreachable by keyboard, and read by screen readers only
 * sometimes. And the old `HelpIcon` opened on `touchstart` and toggled shut on
 * the `click` that followed, so on a tablet it flashed and vanished.
 *
 * The contract, each point a measured defect somewhere:
 *
 * - **A real button.** Click, tap, Enter and Space open it. `aria-expanded`
 *   and `aria-controls` say it is open and where; the panel is a non-modal
 *   `role="dialog"` that takes focus, so a screen reader reads the help the
 *   moment it opens.
 * - **Escape closes it — only it.** The key is claimed in the capture phase, so
 *   a help opened inside a form dialog does not close the form as well
 *   (`useDialogChrome` answers Escape on `document`, after this).
 * - **Focus comes back.** Escape, the close button and Tab out of the panel
 *   return focus to the trigger; a tap elsewhere closes it and leaves focus
 *   where the user put it.
 * - **Touch sizing follows the POINTER** (`useCoarsePointer`): an invisible
 *   hit area of at least 44 px on a coarse pointer, 24 px for a mouse, without
 *   changing the layout — the glyph stays 16 px.
 * - **Hover and focus are a preview, never the only way.** A mouse hovering
 *   the trigger, or Tab landing on it, shows the short help; a finger never
 *   triggers a hover state, so a tap opens and pins it in one step.
 *
 * Not built on `Dialog`/`useDialogChrome`: those are MODAL (scroll lock, focus
 * trap, scrim), and help beside a field must leave the field usable. It shares
 * their Escape and focus-return contract instead.
 */
export default function Toggletip({
  content,
  expandedContent,
  position = "top",
  subject,
  children,
  label,
  className = "",
  triggerClassName = "",
  triggerStyle,
  "data-testid": testId,
}: ToggletipProps): JSX.Element {
  const { t } = useTranslation("common");
  const coarse = useCoarsePointer();
  const [pinned, setPinned] = useState(false);
  const [peek, setPeek] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  /** Focus handed BACK to the trigger must not pop the preview open again. */
  const returningFocus = useRef(false);
  const visible = pinned || peek;

  const helpName = subject ? t("help.about", { subject }) : t("accessibility.showHelp");
  const triggerName = children ? label : helpName;

  const close = useCallback((returnFocus: boolean): void => {
    setPinned(false);
    setPeek(false);
    if (returnFocus) {
      returningFocus.current = true;
      triggerRef.current?.focus();
      returningFocus.current = false;
    }
  }, []);

  const reposition = useCallback((): void => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const at = placeToggletip(
      position,
      trigger.getBoundingClientRect(),
      panel.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight }
    );
    setPlacement({ left: at.left, top: at.top });
  }, [position]);

  useLayoutEffect(() => {
    if (!visible) return;
    reposition();
    const onMove = (): void => reposition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [visible, pinned, reposition]);

  // Opened on purpose: the panel takes focus, so its text is read out.
  useEffect(() => {
    if (pinned) panelRef.current?.focus({ preventScroll: true });
  }, [pinned]);

  useEffect(() => {
    if (!visible) return;
    const inside = (node: EventTarget | null): boolean =>
      node instanceof Node &&
      (!!triggerRef.current?.contains(node) || !!panelRef.current?.contains(node));

    // Capture phase on window: runs before any dialog's `document` listener,
    // so one Escape closes the help and nothing underneath it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(pinned && inside(document.activeElement));
        return;
      }
      if (event.key !== "Tab" || !pinned) return;
      const panel = panelRef.current;
      const active = document.activeElement;
      if (!panel || !(active instanceof Node) || !panel.contains(active)) return;
      // The panel is portalled to <body>, so Tab out of it would land at the
      // end of the page (or inside a dialog's trap). Leaving the panel in
      // either direction goes back to the trigger instead.
      const focusables = panel.querySelectorAll<HTMLElement>("button, a[href]");
      const last = focusables[focusables.length - 1];
      const leaving = event.shiftKey
        ? active === panel || active === focusables[0]
        : active === last;
      if (!leaving) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target)) close(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    if (pinned) document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [visible, pinned, close]);

  /** Focus moved somewhere that is neither trigger nor panel: the help goes. */
  const onBlur = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (!next) return;
    if (triggerRef.current?.contains(next) || panelRef.current?.contains(next)) return;
    close(false);
  };

  const hit = coarse ? "var(--ts-size-touch-min)" : FINE_HIT;

  const panel = visible ? (
    <div
      ref={panelRef}
      id={panelId}
      role={pinned ? "dialog" : "tooltip"}
      aria-label={pinned ? helpName : undefined}
      tabIndex={-1}
      onBlur={onBlur}
      onPointerLeave={(event) => {
        if (!pinned && event.pointerType === "mouse") setPeek(false);
      }}
      data-testid={testId ? `${testId}-panel` : undefined}
      className="fixed z-9999 max-w-sm rounded-lg p-3 text-xs shadow-xl wrap-break-word sm:max-w-md"
      style={{
        ...placement,
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="whitespace-normal">{content}</div>
      {expandedContent && !pinned && (
        <p className="mt-2 italic" style={{ color: "var(--accent)" }}>
          {t("help.clickForMore")}
        </p>
      )}
      {expandedContent && pinned && (
        <div
          className="mt-2 whitespace-normal border-t pt-2"
          style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
        >
          {expandedContent}
        </div>
      )}
      {pinned && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            close(true);
          }}
          onBlur={onBlur}
          className="mt-2 inline-flex items-center underline touch-manipulation"
          style={{
            color: "var(--accent)",
            minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
          }}
        >
          {t("buttons.close")}
        </button>
      )}
    </div>
  ) : null;

  return (
    <>
      <span className={`relative inline-flex items-center ${className}`.trim()}>
        {/* `stopPropagation` on click and on Enter/Space: the trigger sits in
            labels (a click would focus the input) and in table rows that open
            on click and on Enter. Neither may react to opening the help. */}
        <button
          type="button"
          ref={triggerRef}
          data-testid={testId}
          aria-label={triggerName}
          aria-expanded={pinned}
          aria-controls={pinned ? panelId : undefined}
          aria-haspopup="dialog"
          aria-describedby={peek && !pinned ? panelId : undefined}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPeek(false);
            setPinned((open) => !open);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setPeek(true);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== "mouse") return;
            const next = event.relatedTarget;
            if (next instanceof Node && panelRef.current?.contains(next)) return;
            setPeek(false);
          }}
          // Tabbing onto the trigger previews the short help, as a hover does:
          // a sighted keyboard user sees it, a screen reader hears it as the
          // trigger's description. Enter/Space then opens the whole of it.
          onFocus={() => {
            if (!returningFocus.current && !pinned) setPeek(true);
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && panelRef.current?.contains(next)) return;
            if (pinned) onBlur(event);
            else setPeek(false);
          }}
          className={
            children
              ? `relative inline-flex cursor-help items-center touch-manipulation ${triggerClassName}`.trim()
              : "relative inline-flex cursor-help items-center touch-manipulation"
          }
          style={children ? triggerStyle : { color: "var(--text-muted)", ...triggerStyle }}
        >
          {/* The hit area: centred, never smaller than the trigger, at least
              44 px on a coarse pointer — so the glyph keeps its size and the
              row its height. */}
          <span
            aria-hidden
            data-toggletip-hit=""
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: `max(100%, ${hit})`, height: `max(100%, ${hit})` }}
          />
          {children ?? (
            <svg
              aria-hidden
              className="h-4 w-4"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>
      </span>
      {panel && createPortal(panel, document.body)}
    </>
  );
}
