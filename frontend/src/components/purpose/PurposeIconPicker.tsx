import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { purposeIconName } from "../../lib/purposeDisplay";
import { PURPOSE_ICONS } from "../../shared/purposeCatalogue";
import { IconGridPicker } from "../ui/IconGridPicker";

/** The purpose icon chooser: an icon grid, never a select that lists icon names as text. */
export function PurposeIconPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (icon: string) => void;
  className?: string;
}): JSX.Element {
  const { t } = useTranslation(["purpose"]);
  return (
    <IconGridPicker
      value={value}
      onChange={onChange}
      className={className}
      label={t("purpose:custom.icon")}
      testId="purpose-icon-trigger"
      options={PURPOSE_ICONS.map((icon) => ({
        value: icon,
        icon: purposeIconName(icon),
        label: t(`purpose:custom.iconName.${icon}`),
      }))}
    />
  );
}
