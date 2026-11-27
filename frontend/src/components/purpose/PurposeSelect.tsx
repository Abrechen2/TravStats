import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { PurposeCatalogue } from "../../lib/api/purpose";
import { describePurpose, entryPurposeKey } from "../../lib/purposeDisplay";
import { usePurposeCatalogue } from "../../store/purposeCatalogueStore";
import { PURPOSES } from "../../shared/purpose";

/** The value of the "not set" option; the server stores null for it. */
export const PURPOSE_UNSET = "";
/** A detailed key (`builtin:…`, `custom:…`) or `PURPOSE_UNSET`. */
export type PurposeChoice = string;

/** What an entry's stored kind and detail select in the picker. */
export const toChoice = (
  catalogue: PurposeCatalogue,
  entry: { purpose?: string | null; purposeKey?: string | null } | null | undefined
): PurposeChoice => entryPurposeKey(catalogue, entry) ?? PURPOSE_UNSET;

/**
 * The one purpose field of every form: not set, or a purpose from the catalogue (built-ins plus
 * the user's own), grouped by kind. Archived purposes are offered only while selected.
 */
export default function PurposeSelect({
  id,
  value,
  onChange,
  disabled,
  unsetLabel,
}: {
  id: string;
  value: PurposeChoice;
  onChange: (next: PurposeChoice) => void;
  disabled?: boolean;
  /** Replaces "Nicht festgelegt", e.g. "Aus der Reise-Kategorie" where unset means that. */
  unsetLabel?: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["purpose"]);
  const catalogue = usePurposeCatalogue();
  const language = i18n.language ?? "de";
  const keys = [
    ...catalogue.builtins.map((b) => b.key),
    ...catalogue.custom.filter((c) => !c.archived || c.key === value).map((c) => c.key),
  ];
  const options = keys
    .map((k) => describePurpose(t, catalogue, k, language))
    .filter((d): d is NonNullable<typeof d> => d !== null);
  // A key the catalogue does not hold (not loaded yet) stays selectable rather than vanishing.
  const unknownValue = value !== PURPOSE_UNSET && !keys.includes(value);
  return (
    <div>
      <label htmlFor={id} className="t-caption">
        {t("purpose:field.legend")}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-coarse:min-h-(--ts-size-touch-min)"
        style={{ display: "block", minWidth: 160 }}
      >
        <option value={PURPOSE_UNSET}>{unsetLabel ?? t("purpose:field.unknown")}</option>
        {unknownValue && <option value={value}>{t("purpose:field.loading")}</option>}
        {PURPOSES.map((kind) => (
          <optgroup key={kind} label={t(`purpose:kind.${kind}`)}>
            {options
              .filter((o) => o.kind === kind)
              .map((o) => (
                <option key={o.key} value={o.key}>
                  {`${o.label}${o.archived ? ` (${t("purpose:custom.archivedTag")})` : ""}`}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
