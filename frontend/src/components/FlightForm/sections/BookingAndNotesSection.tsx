import type { Dispatch, JSX, SetStateAction } from "react";

import HelpIcon from "../../Help/HelpIcon";
import { useTranslation } from "../../../hooks/useTranslation";
import BookingFields from "../fields/BookingFields";
import CompanionsField from "../fields/CompanionsField";
import TripSelectField from "../fields/TripSelectField";

export interface BookingFieldsValue {
  bookingReference: string;
  ticketNumber: string;
  bookingClassLetter: string;
  baggageAllowance: string;
  frequentFlyerNumber: string;
}

interface BookingAndNotesSectionProps {
  booking: BookingFieldsValue;
  onBookingChange: (value: BookingFieldsValue) => void;
  tripId: string;
  setTripId: (v: string) => void;
  /** Preselects the trip covering this day — see TripSelectField. */
  departureDate: string;
  tags: string[];
  setTags: (v: string[]) => void;
  companions: string[];
  setCompanions: Dispatch<SetStateAction<string[]>>;
  /** Raw parser output, read-only in the UI — see CompanionsField. */
  coPassengers: string[];
  notes: string;
  setNotes: (v: string) => void;
  labelClassName: string;
  mutedTextClassName: string;
  inputClassName: string;
}

/**
 * Everything that belongs to the booking rather than to the flight — the third
 * folded group of the manual flight form (forgejo#88, point 9).
 *
 * The trip, the tags, the people and the notes sit here with the PNR and the
 * ticket number because they share one property: nothing in this group changes
 * a statistic, and none of it can be looked up. It is what the user chooses to
 * write down, which is exactly the part that can wait until the flight itself
 * is recorded.
 */
export default function BookingAndNotesSection({
  booking,
  onBookingChange,
  tripId,
  setTripId,
  departureDate,
  tags,
  setTags,
  companions,
  setCompanions,
  coPassengers,
  notes,
  setNotes,
  labelClassName,
  mutedTextClassName,
  inputClassName,
}: BookingAndNotesSectionProps): JSX.Element {
  const { t } = useTranslation(["flights"]);

  return (
    <div className="space-y-6">
      {/* Booking (#197, #199) — shared with the edit modal */}
      <BookingFields
        value={booking}
        onChange={onBookingChange}
        labelClassName={labelClassName}
        inputClassName={inputClassName}
      />

      {/* Trip (#199) — the assignment runs after the create, see
          useFlightForm.maybeAssignTrip */}
      <TripSelectField
        value={tripId}
        onChange={setTripId}
        preselectForDate={departureDate}
        labelClassName={labelClassName}
        inputClassName={inputClassName}
      />

      <div>
        <label className={`label ${labelClassName} flex items-center gap-2`}>
          {t("flights:form.tags")}
          <HelpIcon
            content={t("flights:form.help.tags")}
            expandedContent={t("flights:form.help.tagsExpanded")}
            position="top"
          />
        </label>
        <input
          type="text"
          value={tags.join(", ")}
          onChange={(e) =>
            setTags(
              e.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            )
          }
          className={`input ${inputClassName}`}
          placeholder={t("flights:form.placeholders.tags")}
        />
        <p className={`text-xs ${mutedTextClassName} mt-1`}>{t("flights:form.tagsHint")}</p>
      </div>

      <CompanionsField
        companions={companions}
        onCompanionsChange={setCompanions}
        coPassengers={coPassengers}
        labelClassName={labelClassName}
      />

      <div>
        <label className={`label ${labelClassName}`}>{t("flights:form.notes")}</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`input ${inputClassName}`}
          rows={3}
          placeholder={t("flights:form.placeholders.notes")}
        />
      </div>
    </div>
  );
}
