import { useCallback, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { MeExportError, meExportApi, type MeExportFailure } from "../../lib/api/meExport";
import { downloadBlob } from "../../lib/export";
import { Icon } from "../ui/Icon";
import { SettingItem } from "../ui/settings";
import { useRowCopy } from "./rowCopy";

type Status = "idle" | "running" | "done" | { failed: MeExportFailure };

/** "Alle meine Daten" — this account's records as one JSON file (forgejo#391). */
export default function MeExportRow(): JSX.Element {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const copy = useRowCopy("data")("meine");
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
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      help={copy.help}
      error={
        typeof status === "object" ? t(`settings:meExport.failed.${status.failed}`) : undefined
      }
      control={
        <button
          type="button"
          onClick={() => void run()}
          disabled={status === "running"}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Icon name="download" size={14} />
          {status === "running"
            ? t("settings:meExport.running")
            : (copy.btn ?? t("settings:meExport.button"))}
        </button>
      }
    >
      {status === "done" && (
        <p className="t-caption" role="status">
          {copy.res ?? t("settings:meExport.done")}
        </p>
      )}
    </SettingItem>
  );
}
