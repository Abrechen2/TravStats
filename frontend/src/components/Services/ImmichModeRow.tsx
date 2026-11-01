import { useEffect, useState, type JSX } from "react";
import { immichApi } from "../../lib/api/immich";
import type { ImmichMode } from "../../types/immich";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { ChoiceControl, ErrorLine, SettingItem, useSettingWrite } from "../ui/settings";
import { useDemoLock } from "./useLockFor";

/**
 * "Fotos verknüpfen oder kopieren" (Dienste › Immich, standard): what a new
 * album link does by default. The account's own setting, written at once; a
 * failed write keeps the choice and says so, and a connection that cannot be
 * read says that instead of drawing the default as if it were the saved value.
 */
export default function ImmichModeRow(): JSX.Element | null {
  const { t } = useTranslation(["settingsRows", "immich"]);
  const demo = useDemoLock();
  const [saved, setSaved] = useState<ImmichMode | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    immichApi.getSettings().then(
      (s) => alive && setSaved(s.defaultMode),
      (error: unknown) => {
        logger.error("Loading the Immich default mode failed:", error);
        if (alive) setLoadFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const write = useSettingWrite<ImmichMode>(
    "services:immichMode",
    saved ?? "link",
    async (mode) => {
      const next = await immichApi.updateSettings({ defaultMode: mode });
      setSaved(next.defaultMode);
    }
  );

  if (loadFailed)
    return <ErrorLine>{t("settingsRows:services.ui.immichModeLoadFailed")}</ErrorLine>;
  if (saved === null) return null;
  return (
    <SettingItem
      title={t("settingsRows:services.ui.immichMode")}
      sub={t(write.value === "link" ? "immich:modeLinkHint" : "immich:modeImportHint")}
      save={write}
      locked={demo}
      control={
        <ChoiceControl<ImmichMode>
          label={t("settingsRows:services.ui.immichMode")}
          value={write.value}
          options={[
            { value: "link", label: t("immich:modeLink") },
            { value: "import", label: t("immich:modeImport") },
          ]}
          onChange={write.choose}
        />
      }
    />
  );
}
