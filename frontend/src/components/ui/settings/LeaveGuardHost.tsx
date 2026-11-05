import { useEffect, type JSX } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { linkClickTarget } from "../../form/linkClickTarget";
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
      const to = linkClickTarget(event);
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
