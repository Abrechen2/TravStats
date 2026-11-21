import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/** One entry of the trip a booking can cover. */
export interface BookingEntryOption {
  id: string;
  label: string;
  /** The booking this entry is filed on now, if any. */
  bookingId: string | null | undefined;
}

export interface BookingEntrySelection {
  flightIds: string[];
  stayIds: string[];
  cruiseIds: string[];
  /** Rides and rentals a package sold too (forgejo#430). */
  railIds?: string[];
  busIds?: string[];
  ferryIds?: string[];
  rentalIds?: string[];
}

export type BookingEntryKind = keyof BookingEntrySelection;

/** The entries a booking may cover, per kind; a kind left out offers nothing. */
export type BookingEntryOptions = Partial<Record<BookingEntryKind, BookingEntryOption[]>>;

interface Props {
  options: BookingEntryOptions;
  value: BookingEntrySelection;
  onChange: (next: BookingEntrySelection) => void;
  /** The booking being edited, so an entry filed on ANOTHER booking can say so. */
  bookingId: string | null;
}

const GROUPS: readonly { kind: BookingEntryKind; titleKey: string }[] = [
  { kind: "flightIds", titleKey: "trips:bookingEdit.entries.flights" },
  { kind: "stayIds", titleKey: "trips:bookingEdit.entries.stays" },
  { kind: "cruiseIds", titleKey: "trips:bookingEdit.entries.cruises" },
  { kind: "railIds", titleKey: "trips:bookingEdit.entries.rail" },
  { kind: "busIds", titleKey: "trips:bookingEdit.entries.bus" },
  { kind: "ferryIds", titleKey: "trips:bookingEdit.entries.ferry" },
  { kind: "rentalIds", titleKey: "trips:bookingEdit.entries.rentals" },
];

/** Every kind a booking can cover, in the order the picker shows them. */
export const BOOKING_ENTRY_KINDS: readonly BookingEntryKind[] = GROUPS.map((g) => g.kind);

/** The entries a package booking was ticked for when it was opened (#356). */
export function initialSelection(
  options: BookingEntryOptions,
  bookingId: string | null
): BookingEntrySelection {
  const pick = (kind: BookingEntryKind): string[] =>
    bookingId
      ? (options[kind] ?? []).filter((o) => o.bookingId === bookingId).map((o) => o.id)
      : [];
  const selection: BookingEntrySelection = {
    flightIds: pick("flightIds"),
    stayIds: pick("stayIds"),
    cruiseIds: pick("cruiseIds"),
  };
  // A kind the trip offers nothing of stays out of the request: an absent
  // list leaves that kind alone on the server.
  for (const kind of ["railIds", "busIds", "ferryIds", "rentalIds"] as const) {
    if ((options[kind] ?? []).length > 0) selection[kind] = pick(kind);
  }
  return selection;
}

/**
 * Which of the trip's entries a package booking covers (#356; rides and
 * rentals since forgejo#430). Every entry of the trip is offered — the trip's own rows, not a
 * derived subset — and an entry already on another booking says which, since
 * ticking it moves it here.
 */
export function BookingEntriesPicker({ options, value, onChange, bookingId }: Props): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const toggle = (kind: BookingEntryKind, id: string, on: boolean): void => {
    const current = value[kind] ?? [];
    onChange({
      ...value,
      [kind]: on ? [...current, id] : current.filter((x) => x !== id),
    });
  };
  const groups = GROUPS.filter((g) => (options[g.kind] ?? []).length > 0);
  if (groups.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t("trips:bookingEdit.entries.none")}
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="booking-entries">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t("trips:bookingEdit.entries.hint")}
      </p>
      {groups.map((g) => (
        <fieldset key={g.kind}>
          <legend className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            {t(g.titleKey)}
          </legend>
          <ul className="space-y-1">
            {(options[g.kind] ?? []).map((o) => {
              const elsewhere = o.bookingId != null && o.bookingId !== bookingId;
              return (
                <li key={o.id}>
                  <label className="flex items-center gap-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)">
                    <input
                      type="checkbox"
                      checked={(value[g.kind] ?? []).includes(o.id)}
                      onChange={(e): void => toggle(g.kind, o.id, e.target.checked)}
                    />
                    <span>{o.label}</span>
                    {elsewhere && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {t("trips:bookingEdit.entries.otherBooking")}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
