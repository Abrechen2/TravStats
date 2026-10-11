import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";

/**
 * The one plain sentence about an instance without a routing provider: rides
 * stay a straight line, and an admin can change that. Admins get the way to
 * the setting; everyone else is told who can.
 */
export function BusNoRoutingNote({ testId }: { testId?: string }): JSX.Element {
  const { t } = useTranslation(["bus"]);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false);
  return (
    <p className="t-caption" data-testid={testId ?? "bus-no-routing"}>
      {t("bus:routing.noProvider")}{" "}
      {isAdmin ? (
        <Link to="/admin?tab=externalServices" className="underline">
          {t("bus:routing.setUp")}
        </Link>
      ) : (
        t("bus:routing.askAdmin")
      )}
    </p>
  );
}
