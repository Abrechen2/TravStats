import type { JSX } from "react";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import type { EnrichmentFieldProposal, LodgingEnrichmentPreview } from "../../lib/api/openData";

/**
 * The house the OpenStreetMap enrichment matched, and what applying would
 * change — shown BEFORE anything is written (2026-10-22). The matched house
 * used to appear only in a server debug log, so a neighbour's stars could land
 * in the record unnoticed. Kept values are listed too: "4 stays (OSM: 5)" is
 * often the first sign that the match is the wrong house.
 */
export default function LodgingEnrichPreviewDialog({
  preview,
  busy,
  onApply,
  onClose,
}: {
  preview: LodgingEnrichmentPreview;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["openData", "common"]);
  const { match } = preview;
  if (!match) return null;

  const fills = preview.fields.some((f) => f.apply);
  const canApply = fills || preview.storesReference;
  const shown = (v: string | number): string => (typeof v === "number" ? `${v} ★` : v);

  const row = (f: EnrichmentFieldProposal): JSX.Element => (
    <li key={f.field} data-testid={`enrich-field-${f.field}`}>
      <span className="t-label-mono">{t(`openData:lodging.field.${f.field}`)}</span>{" "}
      <span style={{ wordBreak: "break-word" }}>
        {f.apply || f.current === null
          ? t("openData:lodging.preview.fill", { proposed: shown(f.proposed) })
          : t("openData:lodging.preview.keep", {
              current: shown(f.current),
              proposed: shown(f.proposed),
            })}
      </span>
    </li>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      maxWidth={520}
      title={t("openData:lodging.preview.title")}
      closeLabel={t("common:buttons.close")}
      dismissLabel={canApply ? t("common:buttons.cancel") : t("common:buttons.close")}
      action={
        canApply ? (
          <Button variant="primary" onClick={onApply} disabled={busy}>
            {busy ? t("openData:lodging.preview.applying") : t("openData:lodging.preview.apply")}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col" style={{ gap: 14 }}>
        <div className="flex flex-col" style={{ gap: 4 }}>
          <p data-testid="enrich-match">
            {t("openData:lodging.preview.found", {
              name: match.name,
              type: match.osmType,
              id: match.osmId,
              m: match.distanceM,
            })}
          </p>
          <a href={match.url} target="_blank" rel="noopener noreferrer">
            {t("openData:lodging.preview.openMap")}
          </a>
        </div>
        <section className="flex flex-col" style={{ gap: 6 }}>
          <h3 className="t-label-mono">{t("openData:lodging.preview.fieldsLabel")}</h3>
          {fills ? null : <p className="t-caption">{t("openData:lodging.preview.nothingNew")}</p>}
          {preview.fields.length > 0 && (
            <ul className="flex flex-col" style={{ gap: 8, listStyle: "none", padding: 0 }}>
              {preview.fields.map(row)}
            </ul>
          )}
        </section>
        {preview.storesReference && (
          <p className="t-caption">{t("openData:lodging.preview.storesReference")}</p>
        )}
      </div>
    </Dialog>
  );
}
