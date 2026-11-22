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
import OverflowMenu from "../../ui/OverflowMenu";
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
/**
 * "Das stimmt so". For a duplicate the server offers `keep`, which answers
 * every flag over the same copies; a plain dismiss would leave the sibling
 * question of a three-copy group open. Other kinds — and an older server
 * that sends no `actions` — get the dismiss they always got.
 */
function answerThisIsRight(flag: DataQualityFlag) {
  if (flag.actions?.includes("keep")) {
    return dataQualityFlagsApi.resolve(flag.id, { action: "keep", revision: flag.revision });
  }
  return flag.revision === undefined
    ? dataQualityFlagsApi.dismiss(flag.id)
    : dataQualityFlagsApi.dismiss(flag.id, flag.revision);
}

export default function ReviewCard({
  flag,
  busy,
  act,
}: {
  flag: DataQualityFlag;
  busy: boolean;
  act: InboxAction;
}) {
  const { t, i18n } = useTranslation(["dataQuality", "common"]);
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
          <div className="flex flex-wrap items-start gap-3">
            <div>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => answerThisIsRight(flag),
                    false,
                    t("dataQuality:inbox.messages.dismissed")
                  )
                }
              >
                {t("dataQuality:flag.actions.dismiss.label")}
              </Button>
              <p className="t-caption mt-1">{t("dataQuality:flag.actions.dismiss.hint")}</p>
            </div>
            {/* The other answers, each with its consequence as the entry's hint: the difference
                between them only matters at the moment of choosing (owner, 2026-11-22: card ⋯). */}
            <OverflowMenu
              label={t(`${W}.moreAnswers`)}
              triggerLabel={t("common:buttons.more")}
              testId="review-card-menu"
              disabled={busy}
              entries={[
                ...(flag.actions?.includes("link")
                  ? [
                      {
                        key: "link",
                        label: t("dataQuality:flag.actions.link.label"),
                        hint: t("dataQuality:flag.actions.link.hint"),
                        onSelect: () =>
                          void act(
                            () =>
                              dataQualityFlagsApi.resolve(flag.id, {
                                action: "link",
                                revision: flag.revision,
                              }),
                            false,
                            t("dataQuality:inbox.messages.linked")
                          ),
                      },
                    ]
                  : []),
                ...(flag.actions?.includes("convert")
                  ? [
                      {
                        key: "convert",
                        label: t("dataQuality:flag.actions.convert.label"),
                        hint: t("dataQuality:flag.actions.convert.hint"),
                        onSelect: () =>
                          void act(
                            () =>
                              dataQualityFlagsApi.resolve(flag.id, {
                                action: "convert",
                                revision: flag.revision,
                              }),
                            false,
                            t("dataQuality:inbox.messages.converted")
                          ),
                      },
                    ]
                  : []),
                {
                  key: "resolve",
                  label: t("dataQuality:flag.actions.resolve.label"),
                  hint: t("dataQuality:flag.actions.resolve.hint"),
                  onSelect: () =>
                    void act(
                      () =>
                        flag.revision === undefined
                          ? dataQualityFlagsApi.resolve(flag.id)
                          : dataQualityFlagsApi.resolve(flag.id, { revision: flag.revision }),
                      false,
                      t("dataQuality:inbox.messages.resolved")
                    ),
                },
              ]}
            />
          </div>
          <Button disabled={busy} onClick={() => void act(() => dataQualityFlagsApi.run())}>
            {t(`${W}.recheck`)}
          </Button>
        </fieldset>
      )}
    </div>
  );
}
