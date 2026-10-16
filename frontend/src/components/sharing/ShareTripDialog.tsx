import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { TripPerson } from "../../types/sharing";
import { Button, Dialog, Field, Select } from "../ui";
import { sharingErrorKey } from "./sharingCopy";

const NS = "sharing:shareDialog";

/**
 * Sharing a trip copies it into another account, and the copy stays theirs
 * (design 2026-10-09, decision 5) — so it is asked, not ticked (spec
 * 2026-10-16, D9): what is copied, what stays private, that it is final, one
 * confirm. Only people the server would accept are offered; the others are
 * listed with the one reason they cannot be chosen yet. A refusal stays on the
 * dialog in its own words.
 *
 * Callers mount this once the people are loaded, so the initial selection
 * sees the final list.
 */
export default function ShareTripDialog({
  open,
  onClose,
  tripId,
  people,
  preselectedKey,
  onShared,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
  people: readonly TripPerson[];
  preselectedKey?: string;
  onShared: () => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const addToast = useToastStore((s) => s.addToast);
  const eligible = people.filter((p) => p.shareBlockedBy === null && p.companionId && p.account);
  const blocked = people.filter((p) => p.shareBlockedBy !== null);
  const [key, setKey] = useState(preselectedKey ?? eligible[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const person = eligible.find((p) => p.key === key) ?? null;
  // A preselected person who cannot be shared with is explained, not offered.
  const shownBlocked = preselectedKey ? blocked.filter((p) => p.key === preselectedKey) : blocked;

  const share = async (): Promise<void> => {
    if (!person?.companionId) return;
    setBusy(true);
    setError(null);
    try {
      await sharingApi.shareTrip(tripId, person.companionId);
      addToast("success", t(`${NS}.done`, { name: person.name }));
      onShared();
      onClose();
    } catch (err) {
      logger.error("Failed to share trip:", err);
      setError(t(sharingErrorKey(err, "sharing:trip.errors.shareFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={person ? t(`${NS}.title`, { name: person.name }) : t(`${NS}.titlePick`)}
      action={
        person ? (
          <Button variant="primary" disabled={busy} onClick={() => void share()}>
            {t(`${NS}.confirm`)}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {eligible.length === 0 ? (
          <p className="text-sm">{t(`${NS}.nobody`)}</p>
        ) : (
          <>
            {!preselectedKey && (
              <Field label={t(`${NS}.person`)} htmlFor="share-trip-person">
                <Select id="share-trip-person" value={key} onChange={(e) => setKey(e.target.value)}>
                  {eligible.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} (@{p.account?.username})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <p className="text-sm">{t(`${NS}.copied`, { name: person?.name ?? "" })}</p>
            <p className="text-sm">{t(`${NS}.private`)}</p>
            <p className="text-sm" style={{ color: "var(--ts-warn)" }}>
              {t(`${NS}.final`, { name: person?.name ?? "" })}
            </p>
          </>
        )}
        {shownBlocked.length > 0 && (
          <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
            <p className="t-caption" style={{ color: "var(--ts-muted)" }}>
              {t(`${NS}.blockedTitle`)}
            </p>
            {shownBlocked.map((p) => (
              <p key={p.key} className="text-sm" style={{ color: "var(--ts-muted)" }}>
                {t(`${NS}.blocked.${p.shareBlockedBy}`, { name: p.name })}
              </p>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
