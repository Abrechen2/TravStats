import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { dataQualityFlagsApi } from "../../../lib/api/dataQualityFlags";
import { countryName } from "../../../shared/geo/countryCode";
import type { DataQualityFlag } from "../../../types/dataQuality";
import FlagContradiction from "../../DataQuality/FlagContradiction";
import {
  flagGroupDescriptionKey,
  flagQuestionGroup,
  flagSubjectLabel,
  flagSubjectPath,
  flagUnchangedKey,
} from "../../DataQuality/flagSubject";
import Button from "../../ui/Button";
import FlagQuickEditor, { type InboxAction } from "./FlagQuickEditor";
import { W } from "./model";

/**
 * One open question about one record — the inbox's only card for it.
 *
 * ## The answers are not synonyms, and the labels say so
 *
 * - **"Ich habe es korrigiert"** (resolve) is about what the USER just did; the
 *   next check re-opens the question if the contradiction survived, which is
 *   what stops it from being a way of hiding a fault.
 * - **"Das stimmt so"** (dismiss) is about what is TRUE; it is never asked
 *   again — the escape hatch for a check that is right about the disagreement
 *   and wrong about the conclusion ("…, Atlanta, Georgia").
 * - The quick editors and "Angaben erneut prüfen" let the check itself decide.
 * - **"Zur Reise hinzufügen"** (`link`, spec 2026-10-25 C3) appears only where
 *   the server offers it in `actions` — today the ferry match.
 *
 * Each carries its consequence as a permanent hint, because the difference only
 * matters at the moment of clicking. A question already answered (the history
 * view) shows its answer and offers none.
 */
export default function ReviewCard({
  flag,
  busy,
  act,
}: {
  flag: DataQualityFlag;
  busy: boolean;
  act: InboxAction;
}) {
  const { t, i18n } = useTranslation(["dataQuality"]);
  const group = flagQuestionGroup(flag);
  const path = flagSubjectPath(flag);
  const label = flagSubjectLabel(
    flag,
    (code) => countryName(code, i18n.language) || t("dataQuality:flag.unknownCountry", { code }),
    t("dataQuality:flag.unnamedRecord"),
    t("dataQuality:flag.homeSubject")
  );
  const open = flag.status === "open";
  return (
    <div className="space-y-4">
      <p className="t-caption">{t(flagGroupDescriptionKey(group))}</p>
      <p className="t-caption">{t(`dataQuality:flag.entityType.${flag.entityType}`)}</p>
      <h4 className="font-semibold">
        {path ? (
          <Link to={path} className="underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </h4>
      <div>
        <h5 className="t-label-mono mb-2">{t(`${W}.evidence`)}</h5>
        <FlagContradiction flag={flag} />
      </div>
      <p className="t-caption">{t(flagUnchangedKey(flag))}</p>
      {!open ? (
        <p role="status" className="t-caption">
          {t(`dataQuality:flag.status.${flag.status}`)}
        </p>
      ) : (
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <legend className="t-label-mono mb-2">{t(`${W}.yourAnswer`)}</legend>
          <FlagQuickEditor flag={flag} busy={busy} act={act} />
          {flag.actions?.includes("link") && (
            <div>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      dataQualityFlagsApi.resolve(flag.id, {
                        action: "link",
                        revision: flag.revision,
                      }),
                    false,
                    t("dataQuality:inbox.messages.linked")
                  )
                }
              >
                {t("dataQuality:flag.actions.link.label")}
              </Button>
              <p className="t-caption mt-1">{t("dataQuality:flag.actions.link.hint")}</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => dataQualityFlagsApi.resolve(flag.id),
                    false,
                    t("dataQuality:inbox.messages.resolved")
                  )
                }
              >
                {t("dataQuality:flag.actions.resolve.label")}
              </Button>
              <p className="t-caption mt-1">{t("dataQuality:flag.actions.resolve.hint")}</p>
            </div>
            <div>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => dataQualityFlagsApi.dismiss(flag.id),
                    false,
                    t("dataQuality:inbox.messages.dismissed")
                  )
                }
              >
                {t("dataQuality:flag.actions.dismiss.label")}
              </Button>
              <p className="t-caption mt-1">{t("dataQuality:flag.actions.dismiss.hint")}</p>
            </div>
          </div>
          <Button disabled={busy} onClick={() => void act(() => dataQualityFlagsApi.run())}>
            {t(`${W}.recheck`)}
          </Button>
        </fieldset>
      )}
    </div>
  );
}
