import { lazy, Suspense, useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { logger } from "../../../lib/logger";
import {
  PLACE_RADIUS_MAX,
  PLACE_RADIUS_MIN,
  placesFailure,
  travTrackPlacesApi,
  type FixedPlace,
  type FixedPlacesAnswer,
} from "../../../lib/api/travtrackPlaces";
import { travTrackApi, type PrivacyZone } from "../../../lib/api/travtrack";
import WebGLGuard from "../../map/WebGLGuard";
import Button from "../../ui/Button";
import { Field, Input } from "../../ui/Field";
import { SettingRows } from "../../ui/SettingRow";
import {
  JumpControl,
  SettingItem,
  StatusValue,
  SwitchControl,
  useGuardedNavigate,
} from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import { useBlockConfirm } from "../useBlockConfirm";
import { RowFailure, useRowAction } from "../location/useRowAction";
import PlaceEditor, { type PlaceDraft } from "./PlaceEditor";
import { hasPosition } from "./PlacesMap";
import { ZONES_CHANGED } from "./zonesChanged";
import { PLACE_RGB, rgbCss } from "./placeColors";

const PlacesMap = lazy(() => import("./PlacesMap"));

const NS = "settings:tt.places";
const HOME_CHANGE_PATH = "/settings/reisearten#home";

type Phase = "loading" | "ok" | "tooOld" | "failed";

/** "Mo–Fr 08:00–18:00" for a window, "always" without one. */
function useWindowLabel(): (place: FixedPlace) => string {
  const { t } = useTranslation(["settings"]);
  return (place) => {
    const w = place.window;
    if (!w) return t(`${NS}.always`);
    const days = [...w.days].sort((a, b) => a - b);
    const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
    const span =
      consecutive && days.length > 2
        ? `${t(`${NS}.days.${days[0]}`)}–${t(`${NS}.days.${days[days.length - 1]}`)}`
        : days.map((d) => t(`${NS}.days.${d}`)).join(", ");
    return `${span} ${w.from}–${w.until}`;
  };
}

/**
 * Settings → TravTrack → Feste Orte (contract:
 * docs/superpowers/specs/2026-11-05-travtrack-fixed-places.md). Home, work and
 * any number of other places with a radius, and the hotel during a booking.
 * Everything inside a radius shows as one stop; the stored points stay.
 *
 * A server without `/travtrack/places` answers 404: the section says the
 * server is too old rather than drawing an empty list that cannot be saved.
 */
export default function TravTrackPlacesSection(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const caps = useTravTrackCapabilities();
  const navigate = useGuardedNavigate();
  const { confirm, dialog } = useBlockConfirm();
  const windowLabel = useWindowLabel();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<FixedPlacesAnswer | null>(null);
  const [editing, setEditing] = useState<FixedPlace | "new" | null>(null);
  const [lodgingRadius, setLodgingRadius] = useState("");
  const [zones, setZones] = useState<PrivacyZone[]>([]);
  const save = useRowAction((err) => t(`${NS}.errors.${placesFailure(err)}`));
  const remove = useRowAction((err) => t(`${NS}.errors.${placesFailure(err)}`));
  const lodging = useRowAction((err) => t(`${NS}.errors.${placesFailure(err)}`));

  const load = useCallback(async (): Promise<void> => {
    try {
      const answer = await travTrackPlacesApi.list();
      setData(answer);
      setLodgingRadius(String(answer.lodgingAsPlace.radiusM));
      setPhase("ok");
    } catch (err) {
      logger.warn("TravTrack places: could not load", err);
      setPhase(placesFailure(err) === "notFound" ? "tooOld" : "failed");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // The map's dashed zones. Their own section reports a failed read; here a missing zone only
  // leaves the outline off the map. The zones section announces its changes, so the map follows.
  useEffect(() => {
    const read = (): void => {
      travTrackApi.zones().then(setZones, (err) => logger.warn("TravTrack places map: zones", err));
    };
    read();
    window.addEventListener(ZONES_CHANGED, read);
    return () => window.removeEventListener(ZONES_CHANGED, read);
  }, []);

  const canWrite = !isDemo && caps?.enabled === true;
  const mapped = (data?.places ?? []).filter(hasPosition);
  // MapLibre fits its bounds once, at mount: new or moved circles need a fresh map.
  const mapKey = [...mapped, ...zones]
    .map((c) => `${c.id}:${c.lat},${c.lon},${c.radiusM}`)
    .join("|");
  const openEditor = (id: string): void => {
    const place = data?.places.find((p) => p.id === id);
    if (!place) return;
    save.clear();
    setEditing(place);
  };
  // Removing stays possible while the area is off but data is held, as the API allows.
  const canDelete = !isDemo && caps !== null && (caps.enabled || caps.hasData);

  const saveDraft = async (draft: PlaceDraft): Promise<void> => {
    const target = editing;
    await save.run(async () => {
      if (draft.home) await travTrackPlacesApi.update("home", draft.input);
      else if (target && target !== "new") await travTrackPlacesApi.update(target.id, draft.input);
      else await travTrackPlacesApi.create(draft.input);
      setEditing(null);
      await load();
    });
  };

  const removePlace = async (place: FixedPlace): Promise<void> => {
    await remove.run(async () => {
      const agreed = await confirm({
        title: t(`${NS}.removeTitle`, { name: place.name }),
        affects: t(`${NS}.removeAffects`, { name: place.name }),
        amount: t(`${NS}.removeAmount`, { metres: place.radiusM }),
        after: t(`${NS}.removeAfter`),
        confirmLabel: t(`${NS}.removeDo`),
      });
      if (!agreed) return;
      await travTrackPlacesApi.remove(place.id);
      await load();
    });
  };

  const writeLodging = async (enabled: boolean, radiusM: number): Promise<void> => {
    await lodging.run(async () => {
      const next = await travTrackPlacesApi.setLodging({ enabled, radiusM });
      setData((current) => (current ? { ...current, lodgingAsPlace: next } : current));
      setLodgingRadius(String(next.radiusM));
    });
  };

  if (phase === "tooOld") {
    return (
      <SectionCard>
        <p role="status" className="t-caption" data-testid="places-too-old" style={{ margin: 0 }}>
          {t(`${NS}.tooOld`)}
        </p>
      </SectionCard>
    );
  }

  const radiusM = Number(lodgingRadius);
  const radiusOk =
    Number.isInteger(radiusM) && radiusM >= PLACE_RADIUS_MIN && radiusM <= PLACE_RADIUS_MAX;
  const skipped = data?.lodgingSkipped ?? 0;

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem title={t(`${NS}.name`)} sub={t(`${NS}.sub`)} help={t(`${NS}.help`)}>
          {phase === "failed" ? (
            <RowFailure error={t(`${NS}.loadError`)} onRetry={() => void load()} />
          ) : phase === "loading" ? (
            <p className="t-caption" style={{ margin: 0 }}>
              {t(`${NS}.loading`)}
            </p>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
                {data?.places.map((place) => (
                  <li key={place.id} data-testid={`place-${place.id}`}>
                    <div
                      className="flex flex-wrap items-center justify-between"
                      style={{ gap: "var(--ts-space-xs) var(--ts-space-md)" }}
                    >
                      <span className="t-body flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <span
                          aria-hidden="true"
                          data-testid={`place-dot-${place.id}`}
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            flex: "none",
                            alignSelf: "center",
                            background: rgbCss(PLACE_RGB[place.kind]),
                          }}
                        />
                        <span>{place.kind === "home" ? t(`${NS}.kinds.home`) : place.name}</span>
                        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                          <StatusValue>
                            {place.kind === "home" && place.lat === null
                              ? t(`${NS}.homeUnknown`)
                              : `${t(`${NS}.radius`, { metres: place.radiusM })} · ${windowLabel(place)}`}
                          </StatusValue>
                        </span>
                      </span>
                      <span
                        className="ml-auto flex flex-wrap items-center justify-end"
                        style={{ gap: "var(--ts-space-xs)" }}
                      >
                        {place.kind === "home" ? (
                          <JumpControl
                            label={t(`${NS}.changeHome`)}
                            onJump={() => navigate(HOME_CHANGE_PATH)}
                          />
                        ) : null}
                        {canWrite && !(place.kind === "home" && place.lat === null) ? (
                          <Button
                            aria-label={`${t(`${NS}.edit`)}: ${place.name}`}
                            onClick={() => {
                              save.clear();
                              setEditing(place);
                            }}
                          >
                            {t(`${NS}.edit`)}
                          </Button>
                        ) : null}
                        {canDelete && place.kind !== "home" ? (
                          <Button
                            disabled={remove.busy}
                            aria-label={`${t(`${NS}.remove`)}: ${place.name}`}
                            onClick={() => void removePlace(place)}
                          >
                            {t(`${NS}.remove`)}
                          </Button>
                        ) : null}
                      </span>
                    </div>
                    {editing !== null && editing !== "new" && editing.id === place.id ? (
                      <PlaceEditor
                        place={place}
                        busy={save.busy}
                        error={save.error}
                        onSave={(draft) => void saveDraft(draft)}
                        onCancel={() => setEditing(null)}
                        onRetry={save.retry}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              {mapped.length > 0 ? (
                <WebGLGuard>
                  <Suspense fallback={null}>
                    <PlacesMap
                      key={mapKey}
                      places={mapped}
                      zones={zones}
                      label={t(`${NS}.mapLabel`)}
                      onPick={canWrite ? openEditor : undefined}
                    />
                  </Suspense>
                </WebGLGuard>
              ) : null}
            </div>
          )}
          <RowFailure error={remove.error} onRetry={remove.retry} />
          {phase === "ok" && canWrite ? (
            editing === "new" ? (
              <PlaceEditor
                place={null}
                busy={save.busy}
                error={save.error}
                onSave={(draft) => void saveDraft(draft)}
                onCancel={() => setEditing(null)}
                onRetry={save.retry}
              />
            ) : (
              <div>
                <Button
                  variant="primary"
                  onClick={() => {
                    save.clear();
                    setEditing("new");
                  }}
                >
                  {t(`${NS}.add`)}
                </Button>
              </div>
            )
          ) : null}
        </SettingItem>

        {phase === "ok" && data ? (
          <SettingItem
            title={t(`${NS}.lodging.name`)}
            sub={t(`${NS}.lodging.sub`)}
            locked={
              isDemo
                ? { why: "demo", reason: t("settings:blocks.lock.demo") }
                : caps?.enabled !== true
                  ? { why: "dependency", reason: t(`${NS}.lodging.off`) }
                  : lodging.busy
                    ? { why: "dependency", reason: t(`${NS}.lodging.saving`) }
                    : undefined
            }
            control={
              <SwitchControl
                checked={data.lodgingAsPlace.enabled}
                label={t(`${NS}.lodging.name`)}
                onChange={(on) => void writeLodging(on, data.lodgingAsPlace.radiusM)}
              />
            }
          >
            <Field
              label={t(`${NS}.lodging.radius`)}
              htmlFor="tt-lodging-radius"
              error={
                radiusOk
                  ? undefined
                  : t(`${NS}.editor.radiusInvalid`, {
                      min: PLACE_RADIUS_MIN,
                      max: PLACE_RADIUS_MAX,
                    })
              }
            >
              <Input
                id="tt-lodging-radius"
                type="number"
                inputMode="numeric"
                min={PLACE_RADIUS_MIN}
                max={PLACE_RADIUS_MAX}
                value={lodgingRadius}
                disabled={!canWrite || lodging.busy}
                onChange={(e) => setLodgingRadius(e.target.value)}
              />
            </Field>
            {canWrite && radiusOk && radiusM !== data.lodgingAsPlace.radiusM ? (
              <div>
                <Button
                  disabled={lodging.busy}
                  onClick={() => void writeLodging(data.lodgingAsPlace.enabled, radiusM)}
                >
                  {t(`${NS}.lodging.saveRadius`)}
                </Button>
              </div>
            ) : null}
            {skipped > 0 ? (
              <p className="t-caption" role="status" style={{ margin: 0 }}>
                {t(`${NS}.lodging.skipped`, { count: skipped })}
              </p>
            ) : null}
            <RowFailure error={lodging.error} onRetry={lodging.retry} />
          </SettingItem>
        ) : null}
      </SettingRows>
      {dialog}
    </SectionCard>
  );
}
