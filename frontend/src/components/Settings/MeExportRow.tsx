import { useCallback, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { MeExportError, meExportApi, type MeExportFailure } from "../../lib/api/meExport";
import { downloadBlob } from "../../lib/export";
import { Icon } from "../ui/Icon";
import { SettingRow } from "../ui/SettingRow";

type Status = "idle" | "running" | "done" | { failed: MeExportFailure };

/** "Download my data" — this account's records as one JSON file (forgejo#391). */
export default function MeExportRow(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [status, setStatus] = useState<Status>("idle");

  const run = useCallback(async () => {
    setStatus("running");
    try {
      const file = await meExportApi.download();
      downloadBlob(file.blob, file.filename);
      setStatus("done");
    } catch (err) {
      setStatus({ failed: err instanceof MeExportError ? err.reason : "server" });
    }
  }, []);

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <SettingRow
        title={t("settings:meExport.title")}
        sub={t("settings:meExport.description")}
        control={
          <button
            type="button"
            onClick={() => void run()}
            disabled={status === "running"}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Icon name="download" size={14} />
            {status === "running" ? t("settings:meExport.running") : t("settings:meExport.button")}
          </button>
        }
      />
      {status === "done" && (
        <p className="t-caption" role="status">
          {t("settings:meExport.done")}
        </p>
      )}
      {typeof status === "object" && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t(`settings:meExport.failed.${status.failed}`)}
        </p>
      )}
    </div>
  );
}
