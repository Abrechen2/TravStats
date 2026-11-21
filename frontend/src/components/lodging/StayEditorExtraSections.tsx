import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import TagInput from "../TagInput";
import { Field } from "../ui/Field";
import LoyaltyManageLink from "../Loyalty/LoyaltyManageLink";
import { StayEditorSection } from "./StayEditorSection";
import { INPUT_CLASS } from "./stayEditorShared";
import type { TagSuggestion } from "../../lib/api/tags";
import type { LodgingMembership } from "../../types/lodging";

export function StayEditorAmenitiesSection({
  fid,
  roomAmenities,
  onRoomAmenitiesChange,
  suggestions,
  bookingReference,
  onBookingReferenceChange,
}: {
  fid: string;
  roomAmenities: string[];
  onRoomAmenitiesChange: (v: string[]) => void;
  suggestions: ReadonlyArray<TagSuggestion>;
  bookingReference: string;
  onBookingReferenceChange: (v: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  return (
    <StayEditorSection title={t("lodging:stayEditor.amenitiesSection")}>
      <Field label={t("lodging:field.roomAmenities")} htmlFor={`${fid}-roomAmenities`}>
        <TagInput
          id={`${fid}-roomAmenities`}
          value={roomAmenities}
          onChange={onRoomAmenitiesChange}
          suggestions={suggestions}
          listLabel={t("lodging:field.amenitySuggestions")}
          removeLabel={(name) => t("lodging:field.removeAmenity", { name })}
          placeholder={t("lodging:field.roomAmenitiesPlaceholder")}
          className={INPUT_CLASS}
        />
      </Field>
      <div className="mt-3">
        <Field label={t("lodging:field.bookingReference")} htmlFor={`${fid}-reference`}>
          <input
            id={`${fid}-reference`}
            className={INPUT_CLASS}
            value={bookingReference}
            onChange={(e): void => onBookingReferenceChange(e.target.value)}
          />
        </Field>
      </div>
    </StayEditorSection>
  );
}

export function StayEditorLoyaltySection({
  resolvedMembership,
  resolvedMembershipName,
  showOverride,
  onToggleOverride,
  membershipId,
  membershipOptOut,
  onMembershipChange,
  memberships,
}: {
  resolvedMembership: { source: string };
  resolvedMembershipName: string | null;
  showOverride: boolean;
  onToggleOverride: () => void;
  membershipId: string;
  membershipOptOut: boolean;
  onMembershipChange: (membershipId: string, optOut: boolean) => void;
  memberships: LodgingMembership[];
}): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  return (
    <StayEditorSection title={t("lodging:stayEditor.loyaltySection")}>
      <div data-testid="stay-editor-membership" className="text-sm">
        <span className="text-[var(--text-primary)]">
          {resolvedMembershipName ?? t("lodging:field.noMembership")}
        </span>
        <span className="ml-2 text-xs text-[var(--text-muted)]">
          {t(`lodging:field.membershipSource.${resolvedMembership.source}`)}
        </span>
      </div>
      <button
        type="button"
        data-testid="stay-editor-membership-override-toggle"
        onClick={onToggleOverride}
        className="mt-1 text-xs text-[var(--accent)] hover:underline pointer-coarse:min-h-(--ts-size-touch-min)"
      >
        {t("lodging:stayEditor.overrideMembership")}
      </button>
      {showOverride && (
        <select
          data-testid="stay-editor-membership-select"
          aria-label={t("lodging:field.membership")}
          className={`mt-2 ${INPUT_CLASS}`}
          value={membershipOptOut ? "__none__" : membershipId}
          onChange={(e): void => {
            const v = e.target.value;
            onMembershipChange(v === "__none__" ? "" : v, v === "__none__");
          }}
        >
          <option value="">{t("lodging:field.membershipDerive")}</option>
          <option value="__none__">{t("lodging:field.membershipNone")}</option>
          {memberships.map((m) => (
            <option key={m.id} value={m.id}>
              {m.programName}
            </option>
          ))}
        </select>
      )}
      <div className="mt-1">
        <LoyaltyManageLink testId="stay-editor-membership-manage-link" />
      </div>
    </StayEditorSection>
  );
}
