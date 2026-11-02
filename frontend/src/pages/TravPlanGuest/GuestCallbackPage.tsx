import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { travplanGuestsApi } from "../../lib/api/travplanGuests";
import { GuestFrame } from "./GuestFrame";
import { guestErrorKey } from "./guestErrors";

export const readVouchFragment = (hash: string): string | null => {
  const m = /^#vouch=([A-Za-z0-9_.-]{20,2000})$/.exec(hash);
  return m ? m[1] : null;
};

/**
 * Step 4 (spec §6.5): the guest's server sent the browser back with a vouch in the fragment.
 * The host checks it and opens a session for this one plan.
 */
export default function GuestCallbackPage() {
  const { t } = useTranslation("travplan");
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const vouch = readVouchFragment(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    if (!vouch) {
      setError(t("guests.join.incomplete"));
      return;
    }
    travplanGuestsApi
      .completeJoin(vouch)
      .then((joined) => navigate("/guest/plan/" + joined.tripId, { replace: true }))
      .catch((cause: unknown) =>
        setError(t(guestErrorKey(cause), { defaultValue: t("errors.unknown") }))
      );
  }, [navigate, t]);
  return (
    <GuestFrame>
      {error ? (
        <EmptyState
          kind="degraded"
          title={t("guests.join.failedTitle")}
          description={error}
          action={<Link to="/login">{t("guests.join.toLogin")}</Link>}
        />
      ) : (
        <EmptyState kind="pending" title={t("guests.join.working")} />
      )}
    </GuestFrame>
  );
}
