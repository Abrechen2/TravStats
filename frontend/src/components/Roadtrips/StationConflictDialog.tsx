import { useMemo, useState } from "react";
import type { JSX } from "react";

import Modal from "../Modal";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { EditorStation } from "../../lib/roadtrip/editorStation";
import {
  fieldValue,
  type Choice,
  type MergeConflict,
  type StationField,
  type StationMerge,
} from "../../lib/roadtrip/stationMerge";

/**
 * The per-field choice before local station edits go over a NEWER server
 * state (forgejo#244) — after a restore, or when an autosave met a list the
 * phone had changed. Every conflict names the station, the field and both
 * values, and starts on the server's side: pressing "Übernehmen" without
 * looking loses nobody's work. What merged without a question is named too,
 * so a station that appeared or disappeared is never a surprise.
 */
export default function StationConflictDialog({
  merge,
  origin,
  onApply,
  onClose,
}: {
  merge: StationMerge;
  /** `restore`: a draft from an earlier visit; `live`: a save just refused. */
  origin: "restore" | "live";
  onApply: (merged: EditorStation[]) => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const choose = (id: string, choice: Choice): void =>
    setChoices((prev) => ({ ...prev, [id]: choice }));

  const name = (s: EditorStation): string =>
    s.title.trim() ||
    (s.night.kind === "via" ? t("roadtrips:night.via") : t("roadtrips:editor.unnamed"));

  const show = (s: EditorStation, field: StationField): string => {
    const value = fieldValue(s, field);
    if (value === "") return t("roadtrips:conflict.empty");
    if (field === "startDate" || field === "endDate") {
      return display.date(`${value}T00:00:00Z`, { timeZone: "UTC" });
    }
    if (field === "place") {
      return s.lat !== null && s.lon !== null ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : value;
    }
    if (field === "night") {
      const label = t(`roadtrips:editor.choice.${s.night.kind}.label`);
      const linked =
        s.night.kind === "stay" ? s.stayLabel : s.night.kind === "pass" ? s.placeLabel : null;
      return linked ? `${label} · ${linked}` : label;
    }
    return value;
  };

  const groups = useMemo(() => merge.conflicts, [merge]);

  const options = (c: MergeConflict): { mine: string; theirs: string; legend: string } => {
    switch (c.kind) {
      case "field":
        return {
          legend: t("roadtrips:conflict.fieldLegend", {
            name: name(c.theirs),
            field: t(`roadtrips:conflict.field.${c.field}`),
          }),
          mine: t("roadtrips:conflict.mine", { value: show(c.mine, c.field) }),
          theirs: t("roadtrips:conflict.theirs", { value: show(c.theirs, c.field) }),
        };
      case "removedThere":
        return {
          legend: t("roadtrips:conflict.removedThere", { name: name(c.mine) }),
          mine: t("roadtrips:conflict.restoreMine"),
          theirs: t("roadtrips:conflict.leaveRemoved"),
        };
      case "removedHere":
        return {
          legend: t("roadtrips:conflict.removedHere", { name: name(c.theirs) }),
          mine: t("roadtrips:conflict.removeAnyway"),
          theirs: t("roadtrips:conflict.keepServers"),
        };
      case "order":
        return {
          legend: t("roadtrips:conflict.orderLegend"),
          mine: t("roadtrips:conflict.orderMine"),
          theirs: t("roadtrips:conflict.orderTheirs"),
        };
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("roadtrips:conflict.title")}
      closeLabel={t("common:buttons.close")}
      maxWidth={620}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common:buttons.cancel")}
          </Button>
          <Button variant="primary" onClick={() => onApply(merge.resolve(choices))}>
            {t("roadtrips:conflict.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col" style={{ gap: 14 }}>
        <p className="t-caption">{t(`roadtrips:conflict.intro.${origin}`)}</p>
        {merge.addedThere.length > 0 && (
          <p data-testid="conflict-added">
            {t("roadtrips:conflict.addedThere", {
              names: merge.addedThere.map(name).join(", "),
              count: merge.addedThere.length,
            })}
          </p>
        )}
        {merge.removedThere.length > 0 && (
          <p data-testid="conflict-removed">
            {t("roadtrips:conflict.removedThereKept", {
              names: merge.removedThere.map(name).join(", "),
              count: merge.removedThere.length,
            })}
          </p>
        )}
        {groups.length === 0 && <p>{t("roadtrips:conflict.none")}</p>}
        {groups.map((c) => {
          const o = options(c);
          const current = choices[c.id] ?? "theirs";
          return (
            <fieldset
              key={c.id}
              className="flex flex-col"
              style={{
                gap: 6,
                padding: 12,
                margin: 0,
                borderRadius: "var(--ts-radius-button)",
                border: "1px solid var(--ts-border)",
              }}
            >
              <legend style={{ fontWeight: 700, fontSize: 14, padding: "0 4px" }}>
                {o.legend}
              </legend>
              {(["theirs", "mine"] as const).map((side) => (
                <label
                  key={side}
                  className="flex items-center"
                  style={{ gap: 10, minHeight: "var(--ts-size-touch-min)", cursor: "pointer" }}
                >
                  <input
                    type="radio"
                    name={c.id}
                    checked={current === side}
                    onChange={() => choose(c.id, side)}
                  />
                  <span>{side === "mine" ? o.mine : o.theirs}</span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
    </Modal>
  );
}
