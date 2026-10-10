import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { CRUISE_KINDS, type CruiseKind } from "../../types";

interface Props {
  value: CruiseKind;
  onChange: (kind: CruiseKind) => void;
}

/**
 * Ocean or river (#359). A two-option radio group rather than a checkbox, so
 * both answers are named — "not river" is not a word anyone uses for a
 * Mediterranean cruise. A picked catalogue ship sets it; the user can change it.
 */
export function CruiseKindToggle({ value, onChange }: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  return (
    <fieldset className="mt-3" data-testid="cruise-kind">
      <legend className="mb-1 block text-xs text-(--text-muted)">{t("kind.label")}</legend>
      <div className="flex gap-4">
        {CRUISE_KINDS.map((kind) => (
          <label
            key={kind}
            className="flex items-center gap-2 text-sm text-(--text-primary) pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            <input
              type="radio"
              name="cruise-kind"
              value={kind}
              checked={value === kind}
              onChange={(): void => onChange(kind)}
            />
            {t(`kind.${kind}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
