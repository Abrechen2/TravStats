import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { provenanceApi, type ProvenanceNotice } from "../../lib/api/provenance";
import { logger } from "../../lib/logger";
import { Button } from "../ui";
import { Card } from "../ui/Card";

/**
 * "Erinnerung und Beleg widersprechen sich" — a remembered date that a recorded one contradicts.
 * Nothing is overwritten: the user edits the entry or leaves both. A failed load or answer is
 * said in place, never a silently empty block; the section disappears when there is nothing.
 */
export default function ProvenanceNoticesSection(): JSX.Element | null {
  const { t } = useTranslation(["provenance"]);
  const [items, setItems] = useState<ProvenanceNotice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<"load" | "answer" | null>(null);

  const load = useCallback(async (keepError = false): Promise<void> => {
    try {
      setItems(await provenanceApi.notices());
      if (!keepError) setError(null);
    } catch (err) {
      logger.warn("Failed to load provenance notices:", err);
      setError("load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = async (id: string): Promise<void> => {
    setBusy(id);
    let failed = false;
    try {
      await provenanceApi.dismiss(id);
      setError(null);
    } catch (err) {
      logger.warn("Failed to dismiss a provenance notice:", err);
      failed = true;
      setError("answer");
    } finally {
      setBusy(null);
      await load(failed);
    }
  };

  if (items.length === 0 && !error) return null;

  const sentence = (n: ProvenanceNotice): string =>
    t(`provenance:notices.${n.kind}`, {
      remembered: n.detail.remembered.label,
      recorded: n.detail.recorded.label,
      rFrom: n.detail.remembered.from ?? "?",
      rTo: n.detail.remembered.to ?? "?",
      cFrom: n.detail.recorded.from ?? "?",
      cTo: n.detail.recorded.to ?? "?",
    });

  return (
    <Card style={{ marginBottom: "var(--ts-space-xl)" }} aria-labelledby="provenance-notices-title">
      <h3
        id="provenance-notices-title"
        style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
      >
        {t("provenance:notices.title")}
      </h3>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
        {t("provenance:notices.description")}
      </p>
      {error && (
        <p
          role="alert"
          className="t-caption"
          style={{ marginTop: "var(--ts-space-md)", color: "var(--ts-warn)" }}
        >
          {t(`provenance:notices.errors.${error}`)}
        </p>
      )}
      <ul
        className="flex flex-col"
        style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-lg)" }}
      >
        {items.map((n) => (
          <li
            key={n.id}
            className="flex flex-wrap items-center justify-between gap-2"
            style={{ borderTop: "1px solid var(--ts-border)", paddingTop: "var(--ts-space-md)" }}
          >
            <span className="text-sm" style={{ minWidth: 0 }}>
              <span className="t-caption">
                {t(`provenance:notices.type.${n.detail.remembered.type}`)}
                {" · "}
              </span>
              {sentence(n)}
            </span>
            <Button disabled={busy === n.id} onClick={() => void dismiss(n.id)}>
              {t("provenance:notices.dismiss")}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
