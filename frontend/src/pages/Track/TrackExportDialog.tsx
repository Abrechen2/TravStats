import { useEffect, useState } from "react";
import type { JSX } from "react";
import Dialog from "../../components/ui/Dialog";
import Button from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { downloadBlob } from "../../lib/export";
import { logger } from "../../lib/logger";
import { trackErrorKey, travTrackApi, type TravTrackExportFormat } from "../../lib/api/travtrack";
import { token } from "../../components/ui/tokens";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The span offered first: the day shown, or the whole history in Settings. */
  fromDay: string;
  toDay: string;
}

type Status = { tone: "ok" | "warn" | "bad"; key: string } | null;

/**
 * "Exportieren" (TravTrack plan T6): a span of days and GPX or JSON, then the
 * file. A truncated file says so; a refusal (TravTrack off and nothing held, a
 * span over 366 days) names its reason in the reader's language.
 */
export default function TrackExportDialog({ open, onClose, fromDay, toDay }: Props): JSX.Element {
  const { t } = useTranslation(["track", "common"]);
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);
  const [format, setFormat] = useState<TravTrackExportFormat>("gpx");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(fromDay);
    setTo(toDay);
    setStatus(null);
  }, [open, fromDay, toDay]);

  const valid = from !== "" && to !== "" && from <= to;

  const download = async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      const file = await travTrackApi.exportFile({ fromDay: from, toDay: to }, format);
      downloadBlob(file.blob, file.filename);
      setStatus(
        file.truncated
          ? { tone: "warn", key: "track:export.truncated" }
          : { tone: "ok", key: "track:export.done" }
      );
    } catch (err) {
      logger.warn("TravTrack export failed", err);
      setStatus({ tone: "bad", key: trackErrorKey(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("track:export.title")}
      busy={busy}
      dismissLabel={t("common:buttons.close")}
      action={
        <Button variant="primary" disabled={!valid || busy} onClick={() => void download()}>
          {t("track:export.do")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="t-caption">{t("track:export.intro")}</p>
        <div className="flex flex-wrap gap-3">
          <Field label={t("track:export.from")} htmlFor="track-export-from">
            <Input
              id="track-export-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t("track:export.to")} htmlFor="track-export-to">
            <Input
              id="track-export-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("track:export.format")} htmlFor="track-export-format">
          <Select
            id="track-export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as TravTrackExportFormat)}
          >
            <option value="gpx">{t("track:export.gpx")}</option>
            <option value="json">{t("track:export.json")}</option>
          </Select>
        </Field>
        {status && (
          <p
            className="t-body"
            role={status.tone === "bad" ? "alert" : "status"}
            style={{
              color: token(
                status.tone === "bad" ? "bad" : status.tone === "warn" ? "warn" : "good"
              ),
            }}
          >
            {t(status.key)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
