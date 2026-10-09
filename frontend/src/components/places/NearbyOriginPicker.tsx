import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { LocationInput } from "../location/LocationInput";
import type { Lodging } from "../../types/lodging";
import type { NearbyOrigin } from "./placesNearbyModel";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";

export type OriginMode = "lodging" | "point" | "device";

/** The chosen start, with what to call it. */
export interface ChosenOrigin extends NearbyOrigin {
  mode: OriginMode;
  /** The lodging's id, when it is one. */
  lodgingId?: string;
  label: string;
}

/** Where a device-location request stands — never stored anywhere. */
type DeviceState = "idle" | "asking" | "denied" | "unavailable";

/**
 * Where "nearby" is measured from (forgejo#233): a lodging, a searched place
 * or a point on the map — none of them needs a location permission. The
 * device's own position is an OPTIONAL start: asked once, on a tap, kept in
 * this page's memory only — never in the URL, never sent anywhere, never
 * watched.
 */
export function NearbyOriginPicker({
  mode,
  onModeChange,
  origin,
  onOrigin,
  lodgings,
  lodgingsFailed,
  onRetryLodgings,
  lodgingEnabled,
}: {
  mode: OriginMode;
  onModeChange: (mode: OriginMode) => void;
  origin: ChosenOrigin | null;
  onOrigin: (origin: ChosenOrigin) => void;
  /** Lodgings with a position, or null while they load. */
  lodgings: readonly Lodging[] | null;
  lodgingsFailed: boolean;
  onRetryLodgings: () => void;
  /** The lodging domain is switched on — otherwise its option is not offered. */
  lodgingEnabled: boolean;
}): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const [device, setDevice] = useState<DeviceState>("idle");
  const modes: OriginMode[] = lodgingEnabled ? ["lodging", "point", "device"] : ["point", "device"];

  const askDevice = (): void => {
    if (!("geolocation" in navigator) || !navigator.geolocation) {
      setDevice("unavailable");
      return;
    }
    setDevice("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDevice("idle");
        onOrigin({
          mode: "device",
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: t("places:nearby.origin.deviceLabel"),
        });
      },
      (err) => setDevice(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      // One reading, no watch; an old fix is fine for "what is around me".
      { maximumAge: 300_000, timeout: 15_000 }
    );
  };

  const placed = (lodging: Lodging): boolean => lodging.lat !== null && lodging.lon !== null;

  return (
    <section aria-labelledby="nearby-origin" className="flex flex-col gap-3">
      <h2 id="nearby-origin" className="t-label-mono">
        {t("places:nearby.origin.title")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => onModeChange(m)}
            className={`rounded-full px-4 py-2 text-sm ${COARSE}`}
            style={
              mode === m
                ? {
                    border: "1px solid var(--domain-poi)",
                    color: "var(--domain-poi)",
                    background: "rgba(94,194,178,0.1)",
                  }
                : { border: "1px solid var(--color-border)", color: "var(--text-muted)" }
            }
          >
            {t(`places:nearby.origin.mode.${m}`)}
          </button>
        ))}
      </div>

      {mode === "lodging" &&
        (lodgingsFailed ? (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-sm">
            {t("places:nearby.origin.lodgingsFailed")}
            <button type="button" onClick={onRetryLodgings} className={`underline ${COARSE}`}>
              {t("common:buttons.retry")}
            </button>
          </p>
        ) : lodgings === null ? (
          <p role="status" className="t-caption">
            {t("common:loading.default")}
          </p>
        ) : lodgings.filter(placed).length === 0 ? (
          <p className="t-caption">{t("places:nearby.origin.noLodgings")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="nearby-lodging" className="t-caption">
              {t("places:nearby.origin.lodgingLabel")}
            </label>
            <select
              id="nearby-lodging"
              value={origin?.mode === "lodging" ? (origin.lodgingId ?? "") : ""}
              onChange={(e) => {
                const picked = lodgings.find((l) => l.id === e.target.value);
                if (picked && picked.lat !== null && picked.lon !== null) {
                  onOrigin({
                    mode: "lodging",
                    lodgingId: picked.id,
                    lat: picked.lat,
                    lon: picked.lon,
                    label: picked.name,
                  });
                }
              }}
              className={`w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-3 py-2 text-sm ${COARSE}`}
            >
              <option value="" disabled>
                {t("places:nearby.origin.lodgingPlaceholder")}
              </option>
              {lodgings.filter(placed).map((l) => (
                <option key={l.id} value={l.id}>
                  {[l.name, l.city].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
            {lodgings.some((l) => !placed(l)) && (
              <span className="t-caption">
                {t("places:nearby.origin.unplacedLodgings", {
                  count: lodgings.filter((l) => !placed(l)).length,
                })}
              </span>
            )}
          </div>
        ))}

      {mode === "point" && (
        <LocationInput
          value={origin?.mode === "point" ? { lat: origin.lat, lon: origin.lon } : null}
          onChange={(sel) =>
            onOrigin({
              mode: "point",
              lat: sel.lat,
              lon: sel.lon,
              label: sel.name ?? `${sel.lat.toFixed(4)}, ${sel.lon.toFixed(4)}`,
            })
          }
          idPrefix="nearby-point"
          label={t("places:nearby.origin.pointLabel")}
          compact
        />
      )}

      {mode === "device" && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="t-caption">{t("places:nearby.origin.deviceHint")}</p>
          <button
            type="button"
            onClick={askDevice}
            disabled={device === "asking"}
            className={`self-start rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
            style={{ border: "1px solid var(--color-border)" }}
          >
            {device === "asking"
              ? t("places:nearby.origin.deviceAsking")
              : t("places:nearby.origin.deviceUse")}
          </button>
          {(device === "denied" || device === "unavailable") && (
            <p role="alert" style={{ color: "var(--ts-warn)" }}>
              {t(`places:nearby.origin.device_${device}`)}
            </p>
          )}
        </div>
      )}

      {origin !== null && (
        <p role="status" className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {t("places:nearby.origin.current", { label: origin.label })}
        </p>
      )}
    </section>
  );
}
