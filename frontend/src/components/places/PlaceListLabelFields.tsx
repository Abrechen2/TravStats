// The two controls that decide how a list's places are labelled on the map.
//
// One component, used by both the create form and the detail page, because the
// rule joining the two fields — you cannot ask for a symbol you have not set —
// has to hold in both. Two copies of it would be two chances to disagree.

import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { EmojiPickerField } from "../common/EmojiPickerField";
import type { PlaceLabelMode } from "../../lib/placeLabel";

export interface PlaceListLabelFieldsProps {
  icon: string;
  onIconChange: (icon: string) => void;
  labelMode: PlaceLabelMode;
  onLabelModeChange: (mode: PlaceLabelMode) => void;
  /**
   * Fired when the symbol input is done being edited (blur), never per
   * keystroke.
   *
   * The create form has a Save button and needs none of this. The detail page
   * saves as you go, and without a commit point every character typed into an
   * emoji picker would be its own PATCH — four requests to enter one ZWJ
   * sequence, the last three of them saving half a glyph.
   */
  onIconCommit?: (icon: string) => void;
}

/** Whitespace is not a symbol: a pin drawn from a space is an invisible one. */
export function hasSymbol(icon: string): boolean {
  return icon.trim().length > 0;
}

export function PlaceListLabelFields({
  icon,
  onIconChange,
  labelMode,
  onLabelModeChange,
  onIconCommit,
}: PlaceListLabelFieldsProps): JSX.Element {
  const { t } = useTranslation();
  const symbolAvailable = hasSymbol(icon);

  // Clearing the symbol while "Symbol" is chosen would leave the list asking
  // for something it no longer has. The map already falls back to the name, so
  // nothing would break — but the form would keep showing a choice that has
  // stopped meaning anything, which is how a setting earns a bug report.
  const handleIconChange = (next: string): void => {
    onIconChange(next);
    if (!hasSymbol(next) && labelMode === "icon") onLabelModeChange("name");
  };

  const options: readonly PlaceLabelMode[] = ["name", "icon"];

  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("places:lists.symbolLabel")}
        </span>
        <EmojiPickerField
          value={icon}
          onChange={handleIconChange}
          onCommit={onIconCommit}
          label={t("places:lists.symbolLabel")}
          placeholder={t("places:lists.symbolPlaceholder")}
          hint={t("places:lists.symbolHint")}
        />
      </div>

      <div className="mt-3">
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("places:lists.labelModeLabel")}
        </span>
        <div className="mt-1 flex gap-2">
          {options.map((mode) => {
            const disabled = mode === "icon" && !symbolAvailable;
            const active = labelMode === mode;
            return (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onLabelModeChange(mode)}
                className="rounded-lg px-3 py-1.5 text-sm disabled:opacity-40"
                style={{
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "#0d1117" : "var(--text-secondary)",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--color-border)",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                {t(`places:lists.labelMode.${mode}`)}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {symbolAvailable
            ? t("places:lists.labelModeHint")
            : t("places:lists.labelModeNeedsSymbol")}
        </p>
      </div>
    </>
  );
}
