import type { JSX, ReactNode } from "react";

import { useTranslation } from "../../../hooks/useTranslation";

/**
 * Wraps a thumbnail so a click or Enter opens it large. A real button: keyboard-reachable,
 * named, and it keeps the thumbnail's own layout (no padding, border or background).
 */
export default function EnlargeButton({
  onOpen,
  label,
  children,
  className,
}: {
  onOpen: () => void;
  /** Overrides the default "Foto vergrößern" name, e.g. with the photo's caption. */
  label?: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={label ?? t("common:photoViewer.enlarge")}
      className={className}
      style={{
        padding: 0,
        border: 0,
        background: "none",
        cursor: "zoom-in",
        display: "block",
        lineHeight: 0,
      }}
    >
      {children}
    </button>
  );
}

/**
 * For a thumbnail whose click already means something else (a picker tile that toggles a
 * selection): a small corner button, placed inside a `position: relative` wrapper.
 */
export function EnlargeCorner({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={t("common:photoViewer.enlarge")}
      className="absolute right-0.5 top-0.5 rounded-full text-[11px] leading-none text-white"
      style={{ width: 18, height: 18, background: "rgba(13,17,23,0.75)", cursor: "zoom-in" }}
    >
      ⤢
    </button>
  );
}
