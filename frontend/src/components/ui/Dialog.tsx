import { useEffect, useRef, type CSSProperties, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import IconButton from "./IconButton";
import { Icon } from "./Icon";
import { useDialogChrome } from "./useDialogChrome";
import { useScrimDismiss } from "./useScrimDismiss";
import { useDiscardGuard } from "../form/useDiscardGuard";
import { DiscardQuestion } from "./DiscardQuestion";
import { useTranslation } from "../../hooks/useTranslation";
import { PageErrorList } from "../PageErrorHost";
import { useDialogStackStore } from "../../store/dialogStackStore";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /**
   * ONE action. A dialog that offers two things to do is a dialog that has not
   * decided what it is asking. The dismiss button is not an action.
   */
  action?: ReactNode;
  /** The dismiss label — "Abbrechen" when creating, "Fertig" when editing. */
  dismissLabel?: string;
  /** Accessible name for the close button. */
  closeLabel?: string;
  maxWidth?: number;
  /**
   * Blocks Escape, the scrim, the × and the dismiss button while an action is
   * in flight — `Modal` has always had this, and without it a roadtrip dialog
   * could be cancelled in the middle of its save.
   */
  busy?: boolean;
  /** Unsaved input: every close path asks "discard changes?" first. See `Modal`. */
  dirty?: boolean;
  /** The confirm label of that question, if "Verwerfen" is the wrong word. */
  discardLabel?: string;
  /**
   * The action row of a FRAME dialog (header and footer stay put, only the body
   * scrolls). As a function it receives `requestClose`, the guarded close, so a
   * form's own Cancel asks the same "discard changes?" question as Escape.
   * Giving a footer — or neither `action` nor `dismissLabel` — selects the frame
   * layout; `action`/`dismissLabel` select the simple one.
   */
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  /** The × in the header (frame layout). On by default. */
  showClose?: boolean;
  testId?: string;
}

let idCounter = 0;

/**
 * One shell for every overlay.
 *
 * The app has `Modal.tsx` in five files and twenty-four further hand-rolled
 * `fixed inset-0` overlays, and no two of them agree on the scrim, the radius,
 * whether Escape closes, or whether focus can leave. This is the shell they
 * migrate onto: `surface2`, radius 26, the sheet shadow mirrored, a scrim
 * derived from `canvas`, a focus trap, Escape, and at most one action.
 *
 * Centred on a desktop and docked to the bottom edge below 640px — same shell,
 * different placement, which is the whole of the difference between the web's
 * dialog and the Companion's sheet.
 *
 * This is the SIMPLE cut: a question, a short body, at most one action.
 * `components/Modal.tsx` is the same shell with a frame layout, for the
 * dialogs whose body scrolls under a fixed header and footer. Both take their
 * keyboard behaviour from `useDialogChrome`, which is what makes them one
 * shell rather than two.
 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  action,
  dismissLabel,
  closeLabel,
  maxWidth,
  busy = false,
  dirty = false,
  discardLabel,
  footer,
  showClose = true,
  testId,
}: DialogProps): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  const closeName = closeLabel ?? t("common:buttons.close");
  const coarse = useCoarsePointer();
  const frameLayout = footer !== undefined || (!action && !dismissLabel);
  const width = maxWidth ?? (frameLayout ? 560 : 440);
  const titleIdRef = useRef<string>("");
  if (titleIdRef.current === "") {
    idCounter += 1;
    titleIdRef.current = `dialog-title-${idCounter}`;
  }
  const panelRef = useRef<HTMLDivElement>(null);
  const stackId = titleIdRef.current;
  const isTop = useDialogStackStore((s) => s.open[s.open.length - 1] === stackId);
  useEffect(() => {
    if (!open) return;
    const { push, remove } = useDialogStackStore.getState();
    push(stackId);
    return () => remove(stackId);
  }, [open, stackId]);
  // `reportPageError` while this dialog is on top lands HERE, at the top of the body.
  const errors = isTop ? <PageErrorList inDialog /> : null;
  const guard = useDiscardGuard({ open, dirty, busy, onClose, panelRef });
  const { requestClose } = guard;
  useDialogChrome({ open, onClose: requestClose, panelRef, busy });
  const scrim = useScrimDismiss(panelRef, requestClose);

  if (!open) return null;

  const simpleFrame = createPortal(
    // Everything about the shell lives in `theme/ui.css`, and only the caller's
    // width comes through as a custom property. Written as inline styles it
    // looked right and was wrong: an inline `align-items: center` outranks any
    // media query, so the dialog stayed centred below 640px instead of docking
    // to the bottom edge as a sheet. Found in the browser, not by a test — the
    // tests were green while it was broken.
    <div className="ts-dialog-scrim" {...scrim}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="ts-dialog-panel"
        style={{ "--ts-dialog-max": `${width}px` } as CSSProperties}
      >
        <div className="flex items-start justify-between" style={{ gap: "var(--ts-space-lg)" }}>
          <div className="t-screen-title" style={{ lineHeight: 1.15 }}>
            {title}
          </div>
          <IconButton
            label={closeName}
            onClick={requestClose}
            disabled={busy}
            style={{ margin: "-8px -8px 0 0", background: "var(--ts-surface)" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </IconButton>
        </div>

        <div className="t-body" style={{ textWrap: "pretty" }}>
          {errors}
          {children}
        </div>

        {(action || dismissLabel) && (
          <div className="flex flex-wrap justify-end" style={{ gap: "var(--ts-space-md)" }}>
            {dismissLabel ? (
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                className="ts-button"
                data-variant="secondary"
                style={{
                  height: "var(--ts-size-button-secondary)",
                  padding: "0 var(--ts-space-xl)",
                  borderRadius: "var(--ts-radius-button)",
                  border: "1px solid var(--ts-border-button)",
                  background: "transparent",
                  color: "var(--ts-text)",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                {dismissLabel}
              </button>
            ) : null}
            {action}
          </div>
        )}
      </div>
    </div>,
    document.body
  );

  const footerContent = typeof footer === "function" ? footer(requestClose) : footer;

  const frameDialog = createPortal(
    <div className="ts-dialog-scrim" data-testid={testId} {...scrim}>
      <div
        data-testid="modal-backdrop"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0 }}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleIdRef.current}
        onClick={(event) => event.stopPropagation()}
        // `relative z-10`: the scrim is `fixed` and would otherwise outrank the
        // panel and swallow every click (2.6.0-rc.9 UAT).
        className="ts-dialog-panel relative z-10 flex w-full flex-col"
        data-layout="frame"
        style={{ "--ts-dialog-max": `${width}px` } as CSSProperties}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
          <h2
            id={titleIdRef.current}
            className="text-lg font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </h2>
          {showClose && (
            <IconButton
              label={closeName}
              onClick={requestClose}
              disabled={busy}
              style={{
                margin: "-4px -4px 0 0",
                background: "var(--ts-surface)",
                ...(coarse && {
                  minWidth: "var(--ts-size-touch-min)",
                  minHeight: "var(--ts-size-touch-min)",
                }),
              }}
            >
              <Icon name="x" size={20} />
            </IconButton>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-4">
          {errors}
          {children}
        </div>
        {footerContent && (
          <div
            data-touch={coarse ? "coarse" : undefined}
            className={`flex shrink-0 flex-wrap justify-end gap-2 px-5 py-3 ${
              coarse ? "[&_button:not([data-inline-action])]:min-h-(--ts-size-touch-min)" : ""
            }`}
            style={{ background: "var(--ts-surface)", borderTop: "1px solid var(--ts-border)" }}
          >
            {footerContent}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
  const frame = frameLayout ? frameDialog : simpleFrame;

  // Beside the frame, never inside it — the reason is spelled out in `Modal`.
  return (
    <>
      {frame}
      {guard.asking && (
        <DiscardQuestion
          onDiscard={guard.discard}
          onKeepEditing={guard.keepEditing}
          discardLabel={discardLabel}
        />
      )}
    </>
  );
}
