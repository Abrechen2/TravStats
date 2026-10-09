import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import type { Place } from "../../types/place";
import {
  MERGE_GROUPS,
  sameGroup,
  type MergeChoice,
  type MergeChoices,
  type MergeGroup,
} from "./placeMergeModel";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";

/** The id of a group's first choice — where "still needed" takes the cursor. */
export const mergeGroupId = (group: MergeGroup): string => `place-merge-${group}`;

/**
 * The two places side by side, one group per row (forgejo#232). A group both
 * agree on is shown once and asks nothing; a group where they differ shows
 * both values as buttons and waits — nothing is preselected, because which
 * name or which position is right is exactly what the user knows and the app
 * does not. A row per group rather than a two-column table, so it reads on an
 * iPad held upright.
 */
export function PlaceMergeCompare({
  target,
  source,
  choices,
  onChoose,
}: {
  target: Place;
  source: Place;
  choices: MergeChoices;
  onChoose: (group: MergeGroup, choice: MergeChoice) => void;
}): JSX.Element {
  const { t } = useTranslation(["places", "common"]);

  const shown = (place: Place, group: MergeGroup): string => {
    switch (group) {
      case "name":
        return place.name;
      case "localName":
        return place.localName ?? t("places:merge.none");
      case "category":
        return t(`places:categories.${place.category}`);
      case "position":
        return `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;
      case "address":
        return (
          [place.address, place.city, place.country].filter(Boolean).join(", ") ||
          t("places:merge.none")
        );
      case "notes":
        return place.notes?.trim() || t("places:merge.none");
    }
  };

  const apartMetres = Math.round(
    calculateDistance(target.lat, target.lon, source.lat, source.lon) * 1000
  );

  return (
    <div className="flex flex-col gap-3">
      {MERGE_GROUPS.map((group) => {
        const label = t(`places:merge.group.${group}`);
        if (sameGroup(target, source, group)) {
          return (
            <div key={group} className="flex flex-col gap-0.5">
              <span className="t-caption">{label}</span>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {shown(target, group)}{" "}
                <span style={{ color: "var(--text-muted)" }}>· {t("places:merge.same")}</span>
              </span>
            </div>
          );
        }
        const options: MergeChoice[] =
          group === "notes" ? ["target", "source", "both"] : ["target", "source"];
        return (
          <fieldset key={group} className="flex flex-col gap-1">
            <legend className="t-caption mb-1">{label}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {options.map((option, i) => {
                const on = choices[group] === option;
                return (
                  <button
                    key={option}
                    id={i === 0 ? mergeGroupId(group) : undefined}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChoose(group, option)}
                    className={`flex flex-col items-start rounded-lg px-3 py-2 text-left text-sm ${COARSE}`}
                    style={{
                      border: on ? "2px solid var(--domain-poi)" : "1px solid var(--color-border)",
                      background: on ? "rgba(94,194,178,0.1)" : "transparent",
                    }}
                  >
                    <span className="t-caption">{t(`places:merge.side.${option}`)}</span>
                    <span className="break-words" style={{ color: "var(--text-primary)" }}>
                      {option === "both"
                        ? t("places:merge.bothNotes")
                        : shown(option === "target" ? target : source, group)}
                    </span>
                  </button>
                );
              })}
            </div>
            {group === "position" && (
              <span className="t-caption">{t("places:merge.apart", { metres: apartMetres })}</span>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
