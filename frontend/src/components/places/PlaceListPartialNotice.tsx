import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";

/**
 * "Saved — but these lists did not take it" (forgejo#247: a partly successful
 * action is named, not reported as a failure and not as a success).
 *
 * The place form's footer while it shows this: a toast used to say it and then
 * vanish, and the only way to file the place afterwards was to open each list
 * and search for it. The retry asks again for exactly the lists that refused —
 * never for the place, which is stored.
 */
export function PlaceListPartialNotice({
  names,
  busy,
  onRetry,
  onContinue,
}: {
  names: readonly string[];
  busy: boolean;
  onRetry: () => void;
  onContinue: () => void;
}): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  return (
    <>
      <p role="alert" className="mr-auto self-center text-sm" style={{ color: "var(--ts-warn)" }}>
        {t("places:form.listPartial", { lists: names.join(", "), count: names.length })}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className={`rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
        style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
      >
        {busy ? t("common:buttons.saving") : t("places:form.listRetry")}
      </button>
      <button
        type="button"
        onClick={onContinue}
        disabled={busy}
        className={`btn-primary disabled:opacity-50 ${COARSE}`}
      >
        {t("places:form.listContinue")}
      </button>
    </>
  );
}
