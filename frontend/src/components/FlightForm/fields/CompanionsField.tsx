import { useTranslation } from "../../../hooks/useTranslation";
import CompanionPicker from "../../CompanionPicker";

interface CompanionsFieldProps {
  companions: string[];
  onCompanionsChange: (v: string[]) => void;
  /** Raw parser output (Flight.coPassengers) — rendered read-only, NEVER
   *  editable and never mutated here. `companions` is the user's curated
   *  travel group; two near-identical inputs is exactly the confusion #199
   *  removes, so the parsed names only offer a one-way take-over. */
  coPassengers?: string[];
  labelClassName?: string;
}

/** The companions picker plus the parsed co-passengers beside it, shared
 *  between the create and edit flight forms. The parser has been storing
 *  these names since day one; no form ever showed them.
 *
 *  The row lists only names NOT yet in `companions` and disappears once
 *  every parsed name is taken over (or was already there) — derived state,
 *  so it needs no bookkeeping and can never disagree with the picker. */
export default function CompanionsField({
  companions,
  onCompanionsChange,
  coPassengers,
  labelClassName = "",
}: CompanionsFieldProps): JSX.Element {
  const { t } = useTranslation(["flights"]);

  const pending = (coPassengers ?? []).filter((name) => !companions.includes(name));

  const takeOver = (): void => {
    onCompanionsChange([...companions, ...pending]);
  };

  return (
    <div>
      <label className={`label ${labelClassName}`.trim()}>{t("flights:form.companions")}</label>
      <CompanionPicker value={companions} onChange={onCompanionsChange} />
      {pending.length > 0 && (
        <div
          className="flex items-center gap-2 mt-1 text-xs"
          style={{ color: "var(--text-muted)" }}
          data-testid="co-passengers-row"
        >
          <span>
            {t("flights:form.coPassengersParsed")}: {pending.join(", ")}
          </span>
          <button
            type="button"
            onClick={takeOver}
            className="underline"
            data-testid="co-passengers-take-over"
          >
            {t("flights:form.coPassengersTakeOver")}
          </button>
        </div>
      )}
    </div>
  );
}
