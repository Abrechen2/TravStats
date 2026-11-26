import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import { LIST_COLOR_NAMES, LIST_PALETTE_HEX } from "../../lib/listPalette";
import { paletteColorForRoadtrip } from "../../lib/roadtripColor";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import type { TourRoute } from "../../types/tour";

/**
 * A roadtrip's own map colour (GitHub #408). Its own page always draws it in it
 * (#412); the dashboard and the trip map only when the map's roadtrip colour
 * mode is "per roadtrip", and the field says so. With none chosen the roadtrip keeps
 * the fixed palette colour its id gives it. One request per pick; a failure
 * keeps the stored colour and says why.
 */
export default function RoadtripColorField({
  route,
  onSaved,
}: {
  route: Pick<TourRoute, "id" | "color">;
  onSaved: (route: TourRoute) => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const shown = route.color ?? paletteColorForRoadtrip(route.id);

  const save = async (color: string | null): Promise<void> => {
    setSaving(true);
    setErrorKey(null);
    try {
      onSaved(await toursApi.update(undefined, route.id, { color }));
    } catch (err: unknown) {
      logger.error({ err }, "RoadtripColorField: saving the colour failed");
      setErrorKey(saveErrorKey(err, "roadtrips:mapColor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="roadtrip-color-field">
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-caption">{t("roadtrips:mapColor.label")}</span>
        {LIST_PALETTE_HEX.map((hex, i) => (
          <button
            key={hex}
            type="button"
            // A colour's name, never its hex code: a user picks "Koralle", not "#ef9a86".
            aria-label={t(`common:listColor.${LIST_COLOR_NAMES[i]}`)}
            title={t(`common:listColor.${LIST_COLOR_NAMES[i]}`)}
            aria-pressed={route.color === hex}
            disabled={saving}
            data-testid={`roadtrip-color-${hex.slice(1)}`}
            onClick={(): void => void save(hex)}
            className="h-5 w-5 rounded-full border pointer-coarse:h-8 pointer-coarse:w-8"
            style={{
              background: hex,
              borderColor: route.color === hex ? "var(--ts-text)" : "transparent",
            }}
          />
        ))}
        <button
          type="button"
          className="t-caption underline"
          disabled={saving || route.color === null}
          data-testid="roadtrip-color-auto"
          onClick={(): void => void save(null)}
        >
          {t("roadtrips:mapColor.auto")}
        </button>
        <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: shown }} />
      </div>
      <p className="t-caption" style={{ margin: 0 }} data-testid="roadtrip-color-used-on">
        {t("roadtrips:mapColor.usedOn")}
      </p>
      {errorKey && (
        <p role="alert" className="text-sm text-(--danger)" data-testid="roadtrip-color-error">
          {t(errorKey)}
        </p>
      )}
    </div>
  );
}
