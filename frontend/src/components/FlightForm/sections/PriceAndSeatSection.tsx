import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import CostFields, { type CostFieldsValue } from "../fields/CostFields";

export type SeatClass = "" | "economy" | "premium_economy" | "business" | "first";
export type FlightCategory = "" | "business" | "private" | "vacation";

interface PriceAndSeatSectionProps {
  seatNumber: string;
  boardingGroup: string;
  seatClass: SeatClass;
  category: FlightCategory;
  setSeatNumber: (v: string) => void;
  setBoardingGroup: (v: string) => void;
  setSeatClass: (v: SeatClass) => void;
  setCategory: (v: FlightCategory) => void;
  cost: CostFieldsValue;
  onCostChange: (v: CostFieldsValue) => void;
  showCostBreakdown: boolean;
  priceHelp: { content: string; expandedContent?: string };
  labelClassName: string;
  inputClassName: string;
}

/**
 * What the ticket cost and where you sat — one of the three folded groups of
 * the manual flight form (forgejo#88, point 9).
 *
 * Extracted from `FlightCompleteStep` when the sections landed: that file was
 * 663 lines against an 800-line limit, and three sections' worth of JSX plus
 * their summaries would have taken it past. The grouping is the owner's
 * ("price/cabin/seat"), not a line-count convenience — a seat number and a
 * cabin class are the same question asked twice.
 */
export default function PriceAndSeatSection({
  seatNumber,
  boardingGroup,
  seatClass,
  category,
  setSeatNumber,
  setBoardingGroup,
  setSeatClass,
  setCategory,
  cost,
  onCostChange,
  showCostBreakdown,
  priceHelp,
  labelClassName,
  inputClassName,
}: PriceAndSeatSectionProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className={`label ${labelClassName}`}>{t("flights:form.seat")}</label>
          <input
            type="text"
            value={seatNumber}
            onChange={(e) => setSeatNumber(e.target.value.toUpperCase())}
            className={`input ${inputClassName}`}
            placeholder={t("flights:form.placeholders.seat")}
          />
        </div>
        <div>
          {/* #199 — the edit modal had this all along; the create form
              dropped a parser-provided boarding group on the way in. */}
          <label className={`label ${labelClassName}`}>{t("flights:form.boardingGroup")}</label>
          <input
            type="text"
            value={boardingGroup}
            onChange={(e) => setBoardingGroup(e.target.value)}
            className={`input ${inputClassName}`}
            placeholder={t("flights:form.placeholders.boardingGroup")}
            maxLength={20}
          />
        </div>
        <div>
          <label className={`label ${labelClassName}`}>{t("flights:form.seatClass")}</label>
          <select
            value={seatClass}
            onChange={(e) => setSeatClass(e.target.value as SeatClass)}
            className={`input ${inputClassName}`}
          >
            <option value="">{t("common:labels.optional")}</option>
            <option value="economy">{t("flights:seatClass.economy")}</option>
            <option value="premium_economy">{t("flights:seatClass.premium_economy")}</option>
            <option value="business">{t("flights:seatClass.business")}</option>
            <option value="first">{t("flights:seatClass.first")}</option>
          </select>
        </div>
        <div>
          <label className={`label ${labelClassName}`}>{t("flights:form.category")}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FlightCategory)}
            className={`input ${inputClassName}`}
          >
            <option value="">{t("common:labels.optional")}</option>
            <option value="business">{t("flights:category.business")}</option>
            <option value="private">{t("flights:category.private")}</option>
            <option value="vacation">{t("flights:category.vacation")}</option>
          </select>
        </div>
      </div>

      {/* Cost (#192, #199) — shared with the edit modal; the tax/fee
          breakdown stays behind cost tracking (details in CostFields). */}
      <CostFields
        value={cost}
        onChange={onCostChange}
        showBreakdown={showCostBreakdown}
        priceHelp={priceHelp}
        labelClassName={labelClassName}
        inputClassName={inputClassName}
      />
    </div>
  );
}
