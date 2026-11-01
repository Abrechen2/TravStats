import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { failureKey, immichFailureKind } from "../../lib/api/immich";
import { JobFailedError, JobLostError } from "../../lib/api/jobs";
import { linkVisitPhotosToImmich } from "../../lib/api/places";
import { token } from "../ui/tokens";

type Outcome = { tone: "good" | "bad"; text: string };

/**
 * "Besuchsfotos mit Immich verknüpfen" (forgejo#21, forgejo#397): turns the
 * visit-photo copies the library already holds into links, so they stop taking
 * backup space. The server runs it as a job; every way it can end has its own
 * sentence — a lost job is "unknown", never "failed".
 */
export default function VisitPhotoImmichLink({
  connected,
}: {
  connected: boolean;
}): JSX.Element | null {
  const { t } = useTranslation("immich");
  const { isEnabled } = useEnabledDomains();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Visit photos belong to places; a user without that domain has none.
  if (!connected || !isEnabled("poi")) return null;

  const run = async (): Promise<void> => {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await linkVisitPhotosToImmich();
      setOutcome({
        tone: "good",
        text: t("visitPhotos.done", { checked: r.checked, linked: r.linked }),
      });
    } catch (err) {
      const kind = err instanceof JobFailedError ? err.code : immichFailureKind(err);
      const text =
        err instanceof JobLostError
          ? t("visitPhotos.lost")
          : kind
            ? t(failureKey(kind))
            : t("visitPhotos.failed");
      setOutcome({ tone: "bad", text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="label">{t("visitPhotos.title")}</span>
      <p className="t-caption">{t("visitPhotos.hint")}</p>
      <button
        type="button"
        className="btn-secondary self-start"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? t("visitPhotos.running") : t("visitPhotos.run")}
      </button>
      {outcome && (
        <p role="status" className="text-sm" style={{ color: token(outcome.tone) }}>
          {outcome.text}
        </p>
      )}
    </div>
  );
}
