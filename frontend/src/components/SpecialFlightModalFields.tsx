/**
 * Sub-components for SpecialFlightModal.
 *
 * Extracted from the main modal file so that both files stay under the
 * 800-line hard maximum mandated by CLAUDE.md. Nothing here owns state —
 * every piece is a controlled component driven by the modal.
 */
import DateField from "../components/ui/DateField";
import Chip from "./ui/Chip";
import { Icon } from "./ui/Icon";
import { type IconName } from "./ui/Icon";
import type { Airport } from "../lib/api";
import AirportAutocomplete from "./AirportAutocomplete";
import CompanionPicker from "./CompanionPicker";
import TagInput from "./TagInput";
import { splitTagText } from "../lib/tagList";
import CatalogueCombobox, { searchAircraftOptions } from "./FlightForm/fields/CatalogueCombobox";
import { useTranslation } from "../hooks/useTranslation";
import { EventLocationPicker, type EventLocationValue } from "./specialFlights/EventLocationPicker";
import { FieldError, fieldErrorProps } from "./form";

export type SpecialKind = "sightseeing" | "event" | "zerog";
export type EventSubtype = "eclipse" | "rocket_launch" | "aurora" | "other";

export const ZEROG_PROVIDERS = [
  "ZERO-G Corporation",
  "Novespace",
  "Air Zero G",
  "MiG Flug",
] as const;
export const ZEROG_PROVIDER_OTHER = "__other__";

interface TypePickerProps {
  onPick: (k: SpecialKind) => void;
}

/** The special-flight form's input ids — labels name them, a refusal focuses them. */
export const SPECIAL_IDS = {
  departureAirport: "special-departure-airport",
  arrivalAirport: "special-arrival-airport",
  eventLat: "event-lat",
  eventLon: "event-lon",
  patternLat: "zerog-pattern-lat",
  patternLon: "zerog-pattern-lon",
  departureTime: "special-departure-time",
  arrivalTime: "special-arrival-time",
} as const;

/** Errors at the special-flight fields, already translated (forgejo#246). */
export type SpecialFieldErrors = Partial<Record<keyof typeof SPECIAL_IDS, string | null>>;

export function TypePicker({ onPick }: TypePickerProps): JSX.Element {
  const { t } = useTranslation(["specialFlights"]);
  const chips: Array<{ kind: SpecialKind; icon: IconName }> = [
    { kind: "sightseeing", icon: "landmark" },
    { kind: "event", icon: "moon" },
    { kind: "zerog", icon: "orbit" },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {chips.map(({ kind, icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onPick(kind)}
          className="flex flex-col items-center text-center gap-2 rounded-lg p-5 border transition-colors"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
          }}
        >
          <Icon name={icon} size={24} />
          <span className="font-semibold">{t(`specialFlights:type.${kind}`)}</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t(`specialFlights:typeDescription.${kind}`)}
          </span>
        </button>
      ))}
    </div>
  );
}

interface SightseeingFieldsProps {
  errors?: SpecialFieldErrors;
  airport: Airport | null;
  onAirportChange: (a: Airport | null) => void;
  aircraft: string;
  onAircraftChange: (v: string) => void;
}

export function SightseeingFields({
  errors,
  airport,
  onAirportChange,
  aircraft,
  onAircraftChange,
}: SightseeingFieldsProps): JSX.Element {
  const { t } = useTranslation(["specialFlights"]);
  return (
    <div className="space-y-4">
      <AirportAutocomplete
        id={SPECIAL_IDS.departureAirport}
        error={errors?.departureAirport}
        label={t("specialFlights:field.airport")}
        value={airport}
        onChange={onAirportChange}
        required
      />
      <div>
        <label className="label" htmlFor="special-aircraft">
          {t("specialFlights:field.aircraft")}
        </label>
        {/* The same catalogue the flight forms offer, so a sightseeing flight's
            "Cessna 172" is spelled the way the statistics group it; free text
            stays valid for a type the catalogue does not know. */}
        <CatalogueCombobox
          id="special-aircraft"
          value={aircraft}
          onChange={onAircraftChange}
          search={searchAircraftOptions}
          placeholder={t("specialFlights:field.aircraftHint")}
        />
      </div>
    </div>
  );
}

interface EventFieldsProps {
  errors?: SpecialFieldErrors;
  subtype: EventSubtype;
  onSubtypeChange: (s: EventSubtype) => void;
  departureAirport: Airport | null;
  onDepartureAirportChange: (a: Airport | null) => void;
  arrivalAirport: Airport | null;
  onArrivalAirportChange: (a: Airport | null) => void;
  eventLat: string;
  onEventLatChange: (v: string) => void;
  eventLon: string;
  onEventLonChange: (v: string) => void;
  eventLabel: string;
  onEventLabelChange: (v: string) => void;
}

export function EventFields({
  errors,
  subtype,
  onSubtypeChange,
  departureAirport,
  onDepartureAirportChange,
  arrivalAirport,
  onArrivalAirportChange,
  eventLat,
  onEventLatChange,
  eventLon,
  onEventLonChange,
  eventLabel,
  onEventLabelChange,
}: EventFieldsProps): JSX.Element {
  const { t } = useTranslation(["specialFlights"]);
  const subtypeOptions: Array<{ key: EventSubtype; icon: IconName }> = [
    { key: "eclipse", icon: "moon" },
    { key: "rocket_launch", icon: "rocket" },
    { key: "aurora", icon: "sparkles" },
    { key: "other", icon: "sparkles" },
  ];
  const placeholderKey: EventSubtype = subtype === "other" ? "eclipse" : subtype;

  return (
    <div className="space-y-4">
      <div>
        <p className="label mb-2">{t("specialFlights:subtype_label.question")}</p>
        <div className="flex flex-wrap gap-2">
          {subtypeOptions.map(({ key, icon }) => {
            const active = subtype === key;
            return (
              <Chip key={key} icon={icon} active={active} onClick={() => onSubtypeChange(key)}>
                {t(`specialFlights:subtype.${key}`)}
              </Chip>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <AirportAutocomplete
          id={SPECIAL_IDS.departureAirport}
          error={errors?.departureAirport}
          label={t("specialFlights:field.departureAirport")}
          value={departureAirport}
          onChange={onDepartureAirportChange}
          required
        />
        <AirportAutocomplete
          id={SPECIAL_IDS.arrivalAirport}
          label={t("specialFlights:field.arrivalAirport")}
          value={arrivalAirport}
          onChange={onArrivalAirportChange}
        />
      </div>

      <div>
        <label className="label" htmlFor="event-label">
          {t("specialFlights:field.event_label")}
        </label>
        <input
          id="event-label"
          type="text"
          className="input"
          value={eventLabel}
          onChange={(e) => onEventLabelChange(e.target.value)}
          placeholder={t(`specialFlights:placeholder.${placeholderKey}`)}
        />
      </div>

      <EventLocationPicker
        idPrefix="event"
        errors={{ lat: errors?.eventLat, lon: errors?.eventLon }}
        value={toLocationValue(eventLat, eventLon)}
        onChange={(next) => {
          onEventLatChange(fromLocationCoord(next.lat));
          onEventLonChange(fromLocationCoord(next.lon));
        }}
      />
    </div>
  );
}

/** Convert the modal's (string | "") state into the picker's (number | null). */
function toLocationValue(latStr: string, lonStr: string): EventLocationValue {
  const lat = latStr === "" ? null : Number(latStr);
  const lon = lonStr === "" ? null : Number(lonStr);
  return {
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lon: lon !== null && Number.isFinite(lon) ? lon : null,
  };
}

/** Convert the picker's (number | null) back into the modal's (string | ""). */
function fromLocationCoord(n: number | null): string {
  return n === null ? "" : String(n);
}

interface ZeroGFieldsProps {
  errors?: SpecialFieldErrors;
  airport: Airport | null;
  onAirportChange: (a: Airport | null) => void;
  patternLat: string;
  onPatternLatChange: (v: string) => void;
  patternLon: string;
  onPatternLonChange: (v: string) => void;
  parabolas: number;
  onParabolasChange: (n: number) => void;
  providerPick: string;
  onProviderPickChange: (v: string) => void;
  providerOther: string;
  onProviderOtherChange: (v: string) => void;
}

export function ZeroGFields({
  errors,
  airport,
  onAirportChange,
  patternLat,
  onPatternLatChange,
  patternLon,
  onPatternLonChange,
  parabolas,
  onParabolasChange,
  providerPick,
  onProviderPickChange,
  providerOther,
  onProviderOtherChange,
}: ZeroGFieldsProps): JSX.Element {
  const { t } = useTranslation(["specialFlights"]);
  return (
    <div className="space-y-4">
      <AirportAutocomplete
        id={SPECIAL_IDS.departureAirport}
        error={errors?.departureAirport}
        label={t("specialFlights:field.airport")}
        value={airport}
        onChange={onAirportChange}
        required
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="zerog-pattern-lat">
            {t("specialFlights:field.pattern_lat")}
          </label>
          <input
            id="zerog-pattern-lat"
            type="number"
            step={0.0001}
            min={-90}
            max={90}
            className="input"
            {...fieldErrorProps(SPECIAL_IDS.patternLat, errors?.patternLat)}
            value={patternLat}
            onChange={(e) => onPatternLatChange(e.target.value)}
          />
          <FieldError id={SPECIAL_IDS.patternLat} error={errors?.patternLat} />
        </div>
        <div>
          <label className="label" htmlFor="zerog-pattern-lon">
            {t("specialFlights:field.pattern_lon")}
          </label>
          <input
            id="zerog-pattern-lon"
            type="number"
            step={0.0001}
            min={-180}
            max={180}
            className="input"
            {...fieldErrorProps(SPECIAL_IDS.patternLon, errors?.patternLon)}
            value={patternLon}
            onChange={(e) => onPatternLonChange(e.target.value)}
          />
          <FieldError id={SPECIAL_IDS.patternLon} error={errors?.patternLon} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="zerog-parabolas">
            {t("specialFlights:field.parabolas")}
          </label>
          <input
            id="zerog-parabolas"
            type="number"
            min={1}
            max={100}
            step={1}
            className="input"
            value={parabolas}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              const clamped = Math.min(100, Math.max(1, Math.round(n)));
              onParabolasChange(clamped);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="zerog-provider">
            {t("specialFlights:field.provider")}
          </label>
          <select
            id="zerog-provider"
            className="input"
            value={providerPick}
            onChange={(e) => onProviderPickChange(e.target.value)}
          >
            {ZEROG_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value={ZEROG_PROVIDER_OTHER}>
              {t("specialFlights:picker.provider_other")}
            </option>
          </select>
        </div>
      </div>

      {providerPick === ZEROG_PROVIDER_OTHER && (
        <div>
          <label className="label" htmlFor="zerog-provider-other">
            {t("specialFlights:field.providerOther")}
          </label>
          <input
            id="zerog-provider-other"
            type="text"
            className="input"
            value={providerOther}
            onChange={(e) => onProviderOtherChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

interface CommonTimeAndMetaFieldsProps {
  departureTime: string;
  onDepartureTimeChange: (v: string) => void;
  arrivalTime: string;
  onArrivalTimeChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  tagsCsv: string;
  onTagsCsvChange: (v: string) => void;
  companions: string[];
  onCompanionsChange: (v: string[]) => void;
  errors?: SpecialFieldErrors;
}

export function CommonTimeAndMetaFields({
  errors,
  departureTime,
  onDepartureTimeChange,
  arrivalTime,
  onArrivalTimeChange,
  notes,
  onNotesChange,
  tagsCsv,
  onTagsCsvChange,
  companions,
  onCompanionsChange,
}: CommonTimeAndMetaFieldsProps): JSX.Element {
  const { t } = useTranslation(["specialFlights"]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="special-departure-time">
            {t("specialFlights:field.departureTime")}
          </label>
          <DateField
            inline
            id="special-departure-time"
            kind="datetime-local"
            className="input"
            style={{ colorScheme: "dark" }}
            {...fieldErrorProps(SPECIAL_IDS.departureTime, errors?.departureTime)}
            value={departureTime}
            onChange={(e) => onDepartureTimeChange(e.target.value)}
          />
          <FieldError id={SPECIAL_IDS.departureTime} error={errors?.departureTime} />
        </div>
        <div>
          <label className="label" htmlFor="special-arrival-time">
            {t("specialFlights:field.arrivalTime")}
          </label>
          <DateField
            inline
            id="special-arrival-time"
            kind="datetime-local"
            className="input"
            style={{ colorScheme: "dark" }}
            {...fieldErrorProps(SPECIAL_IDS.arrivalTime, errors?.arrivalTime)}
            value={arrivalTime}
            onChange={(e) => onArrivalTimeChange(e.target.value)}
          />
          <FieldError id={SPECIAL_IDS.arrivalTime} error={errors?.arrivalTime} />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="special-notes">
          {t("specialFlights:field.notes")}
        </label>
        <textarea
          id="special-notes"
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="special-tags">
            {t("specialFlights:field.tags")}
          </label>
          <TagInput
            id="special-tags"
            value={splitTagText(tagsCsv)}
            onChange={(tags) => onTagsCsvChange(tags.join(", "))}
            placeholder={t("specialFlights:placeholder.tags")}
          />
        </div>
        <div>
          <label className="label">{t("specialFlights:field.companions")}</label>
          <CompanionPicker value={companions} onChange={onCompanionsChange} />
        </div>
      </div>
    </div>
  );
}
