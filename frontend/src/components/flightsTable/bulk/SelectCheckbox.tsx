import type { JSX } from "react";
import { CHOICE_TOUCH } from "./ModeChoice";

/**
 * The row's tick for the bulk selection. The whole label is the target and
 * reaches 44 px on a coarse pointer; a click never opens the row behind it.
 */
export default function SelectCheckbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}): JSX.Element {
  return (
    <label
      className={`${CHOICE_TOUCH} pointer-coarse:min-w-(--ts-size-touch-min) justify-center`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={label}
        className="h-4 w-4"
      />
    </label>
  );
}
