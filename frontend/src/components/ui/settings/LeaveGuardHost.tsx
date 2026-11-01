import { useEffect, type JSX } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { navigateAfterSave } from "../../form/unsavedChanges";
import ConfirmDialog from "./ConfirmDialog";
import {
  discardAndLeave,
  dirtySummary,
  hasDirtyGroups,
  requestLeave,
  stayOnPage,
  usePendingLeave,
} from "./leaveGuard";
import { flushWrites } from "./writeQueue";

/** An in-app link click that this guard should hold back, as the path to go to. */
function guardedTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.origin !== window.location.origin) return null;
  return anchor.pathname + anchor.search + anchor.hash;
}

/**
 * Mounted once by the settings area. Does the three things nothing else can:
 * asks before an in-app link leaves a page with unsaved groups, shows the
 * "Änderungen verwerfen?" question, and sends the waiting immediate writes
 * when the route changes.
 */
export default function LeaveGuardHost(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const navigate = useNavigate();
  const location = useLocation();
  const pending = usePendingLeave();

  // Router navigation: every immediate write still waiting goes out.
  useEffect(() => () => flushWrites(false), [location.pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (!hasDirtyGroups()) return;
      const to = guardedTarget(event);
      if (to === null) return;
      if (requestLeave({ to })) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Capture: before React's own handler turns the click into a navigation.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!pending) return null;
  const { labels, count } = dirtySummary();
  return (
    <ConfirmDialog
      open
      title={t("settings:blocks.leave.title")}
      affects={labels.join(" · ")}
      amount={t("settings:blocks.leave.amount", { count })}
      after={t("settings:blocks.leave.after")}
      confirmLabel={t("settings:blocks.leave.discard")}
      cancelLabel={t("settings:blocks.leave.stay")}
      onCancel={stayOnPage}
      onConfirm={() =>
        discardAndLeave((leave) => {
          const to = leave.to as string;
          void navigateAfterSave(
            (path, o) =>
              navigate(path, { state: leave.state, replace: o?.replace ?? leave.replace }),
            to
          );
        })
      }
    />
  );
}
