import type { JSX } from "react";
import { purposeIconName } from "../../lib/purposeDisplay";
import { Icon } from "../ui/Icon";

/** A purpose's icon as a line icon (the catalogue stores names, never emoji). */
export function PurposeGlyph({
  icon,
  size = 14,
}: {
  icon: string | undefined;
  size?: 14 | 16;
}): JSX.Element {
  return <Icon name={purposeIconName(icon)} size={size} style={{ verticalAlign: "-2px" }} />;
}
