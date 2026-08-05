import { useTranslation } from "../../../hooks/useTranslation";
import CurrencyInput from "../../CurrencyInput";
import ReceiptUpload from "../../ReceiptUpload";
import HelpIcon from "../../Help/HelpIcon";

/** The cost side of a flight, shared between the create and edit forms.
 *  `undefined` means "not recorded" for every amount — the edit modal keeps
 *  0 in its internal state for historical reasons and converts at the
 *  boundary, but a 0 must never LEAVE either form as a stored price. */
export interface CostFieldsValue {
  price: number | undefined;
  currency: string;
  taxes: number | undefined;
  fees: number | undefined;
  receiptUrl: string;
}

/** A translated help tooltip for the price field — the create form passes
 *  its existing copy through, the edit modal passes nothing. */
interface CostFieldsHelp {
  content: string;
  expandedContent?: string;
}

interface CostFieldsProps {
  value: CostFieldsValue;
  onChange: (value: CostFieldsValue) => void;
  /** The tax/fee breakdown stays behind the cost-tracking feature flag
   *  (#192); price + currency + receipt are always available. */
  showBreakdown: boolean;
  priceHelp?: CostFieldsHelp;
  labelClassName?: string;
  inputClassName?: string;
}

function parseAmount(raw: string): number | undefined {
  return raw ? parseFloat(raw) : undefined;
}

export default function CostFields({
  value,
  onChange,
  showBreakdown,
  priceHelp,
  labelClassName = "",
  inputClassName = "",
}: CostFieldsProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);

  const labelClass = `label ${labelClassName}`.trim();
  const inputClass = `input ${inputClassName}`.trim();

  const set = <K extends keyof CostFieldsValue>(
    field: K,
    fieldValue: CostFieldsValue[K]
  ): void => onChange({ ...value, [field]: fieldValue });

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className={`${labelClass} flex items-center gap-2`}>
            {t("flights:form.price")}
            {priceHelp && (
              <HelpIcon
                content={priceHelp.content}
                expandedContent={priceHelp.expandedContent}
                position="top"
              />
            )}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={value.price ?? ""}
            onChange={(e) => set("price", parseAmount(e.target.value))}
            className={inputClass}
            placeholder={t("flights:form.placeholders.price")}
          />
        </div>
        <div>
          <label className={labelClass}>{t("flights:form.currency")}</label>
          <CurrencyInput
            value={value.currency || "EUR"}
            onChange={(v) => set("currency", v)}
            className={inputClass}
          />
        </div>
      </div>

      {showBreakdown && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{t("common:labels.taxes")}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={value.taxes ?? ""}
              onChange={(e) => set("taxes", parseAmount(e.target.value))}
              className={inputClass}
              placeholder={t("flights:form.placeholders.taxes")}
            />
          </div>
          <div>
            <label className={labelClass}>{t("common:labels.fees")}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={value.fees ?? ""}
              onChange={(e) => set("fees", parseAmount(e.target.value))}
              className={inputClass}
              placeholder={t("flights:form.placeholders.fees")}
            />
          </div>
        </div>
      )}

      <ReceiptUpload
        currentReceiptUrl={value.receiptUrl}
        onUploadSuccess={(receiptUrl) => set("receiptUrl", receiptUrl)}
        onDelete={() => set("receiptUrl", "")}
      />
    </>
  );
}
