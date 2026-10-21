import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";

/**
 * A map layer that could not be loaded, said over the map with a retry —
 * never drawn as an empty layer, which reads as "nothing recorded" (beta.22
 * UAT: a failed rental or cruise-route load looked exactly like none).
 * `messageKey` names what is missing, in the `map` namespace.
 */
export function MapLoadFailedNotice({
  messageKey,
  onRetry,
}: {
  messageKey: string;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useTranslation(["map"]);
  const coarse = useCoarsePointer();
  return (
    <div
      role="alert"
      className="pointer-events-auto absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-(--color-border) px-3 py-1.5 text-sm"
      style={{ background: "rgba(22,27,34,0.85)", color: "var(--danger)" }}
    >
      <span>{t(messageKey)}</span>
      <button
        type="button"
        onClick={onRetry}
        className="underline"
        style={{
          color: "var(--accent)",
          minHeight: coarse ? "var(--ts-size-touch-min)" : undefined,
        }}
      >
        {t("map:loadFailed.retry")}
      </button>
    </div>
  );
}
