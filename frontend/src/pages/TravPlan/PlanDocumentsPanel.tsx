import { useCallback, useEffect, useState } from "react";
import { Card, Input, SectionLabel } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { planDocumentsApi, type PlanDocument } from "../../lib/api/planDocuments";
import { remotePlanErrorKey } from "./remotePlanErrors";
import { PlanNotice, PlanRow, PlanGrow, PlanStack } from "./planLayout";

const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.ceil(bytes / 1024) + " KB";

/**
 * The documents the plan shows its members (spec D6): the ones on its bookings and the ones any
 * member put there for the plan, each labelled with who uploaded it. The server decides what is
 * listed; a co-planner or a member from another server never sees the owner's other documents.
 */
export function PlanDocumentsPanel({ tripId, revision }: { tripId: string; revision: number }) {
  const { t } = useTranslation("travplan");
  const [documents, setDocuments] = useState<PlanDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fail = useCallback(
    (cause: unknown) =>
      setError(t(remotePlanErrorKey(cause), { defaultValue: t("errors.unknown") })),
    [t]
  );
  const load = useCallback(async () => {
    try {
      setDocuments(await planDocumentsApi.list(tripId));
      setError("");
    } catch (cause) {
      fail(cause);
    }
  }, [tripId, fail]);
  useEffect(() => {
    void load();
  }, [load, revision]);
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      await planDocumentsApi.upload(tripId, file);
      await load();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <SectionLabel>{t("planDocs.title")}</SectionLabel>
      <p className="t-caption">{t("planDocs.intro")}</p>
      <PlanStack>
        {documents.length === 0 && <p className="t-caption">{t("planDocs.none")}</p>}
        {documents.map((d) => (
          <PlanRow key={d.id}>
            <PlanGrow>
              <a href={d.url} download>
                {d.displayName}
              </a>
              <p className="t-caption">
                {size(d.sizeBytes)} ·{" "}
                {d.uploadedBy
                  ? t("planDocs.uploadedBy", { name: d.uploadedBy.displayName })
                  : t("planDocs.onBooking")}
              </p>
            </PlanGrow>
          </PlanRow>
        ))}
        {error && <PlanNotice tone="bad">{error}</PlanNotice>}
        <Input
          type="file"
          disabled={busy}
          aria-label={t("planDocs.upload")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </PlanStack>
    </Card>
  );
}
