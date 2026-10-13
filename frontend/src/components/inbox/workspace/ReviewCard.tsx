import { useTranslation } from "../../../hooks/useTranslation";
import { dataQualityFlagsApi } from "../../../lib/api/dataQualityFlags";
import type { DataQualityFlag } from "../../../types/dataQuality";
import FlagContradiction from "../../DataQuality/FlagContradiction";
import Button from "../../ui/Button";
import FlagQuickEditor, { type InboxAction } from "./FlagQuickEditor";
import { W } from "./model";

export default function ReviewCard({
  flag,
  busy,
  act,
}: {
  flag: DataQualityFlag;
  busy: boolean;
  act: InboxAction;
}) {
  const { t } = useTranslation(["dataQuality"]);
  return (
    <div className="space-y-4">
      <div>
        <h4 className="t-label-mono mb-2">{t(`${W}.evidence`)}</h4>
        <FlagContradiction flag={flag} />
      </div>
      <p className="t-caption">{t(`${W}.questionHint`)}</p>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <legend className="t-label-mono mb-2">{t(`${W}.yourAnswer`)}</legend>
        <FlagQuickEditor flag={flag} busy={busy} act={act} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void act(() => dataQualityFlagsApi.run())}>
            {t(`${W}.recheck`)}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void act(() => dataQualityFlagsApi.dismiss(flag.id))}
          >
            {t("dataQuality:flag.actions.dismiss.label")}
          </Button>
        </div>
        <p className="t-caption">{t("dataQuality:flag.actions.dismiss.hint")}</p>
      </fieldset>
    </div>
  );
}
