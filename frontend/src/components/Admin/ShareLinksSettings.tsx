import { useEffect, useState } from "react";
import type { JSX } from "react";
import { adminApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { ConfirmDialog, ErrorLine, SettingItem, SwitchControl } from "../ui/settings";
import { SettingRows } from "../ui/SettingRow";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";
import { useDialogCopy, useRowCopy } from "../Settings/rowCopy";

const NS = "sharing:links.section";

/**
 * "Öffentliche Links erlauben" (design §4 C1/A12): the instance-wide
 * permission, an "Alle Konten" row. Switching it ON writes at once. Switching
 * it OFF deletes every link of every account (`deleteAllShareLinks`), so it
 * goes through the confirmation block, which names the amount the server
 * reports — and a refused write is said, not swallowed.
 */
export default function ShareLinksSettings(): JSX.Element {
  const { t } = useTranslation(["sharing", "settingsRows"]);
  const row = useRowCopy("sharing");
  const dialog = useDialogCopy();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [stats, setStats] = useState<{ links: number; accounts: number } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    adminApi.getInstanceSettings().then(
      (response) => {
        if (!alive) return;
        setEnabled(response.settings.shareLinksEnabled);
        setStats(response.shareLinkStats ?? null);
      },
      (error: unknown) => {
        logger.error("Loading the share-link instance setting failed:", error);
        if (alive) setLoadFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const write = async (on: boolean): Promise<void> => {
    // One request at a time: a second click on a slow save must not queue a delete behind it.
    if (busy) return;
    setAsking(false);
    setBusy(true);
    setSaveFailed(false);
    try {
      const { settings } = await adminApi.updateInstanceSettings({ shareLinksEnabled: on });
      setEnabled(settings.shareLinksEnabled);
      if (!on) setStats({ links: 0, accounts: 0 });
    } catch (error) {
      logger.error("Saving the share-link instance setting failed:", error);
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const copy = row("linkserlaubt");
  const off = dialog("linksoff", { count: stats?.links ?? 0, accounts: stats?.accounts ?? 0 });
  return (
    <SectionCard>
      <SectionTitle title={t("settingsRows:sharing.sections.shareLinks")} />
      <SettingRows>
        {enabled !== null && (
          <SettingItem
            title={copy.title}
            sub={copy.sub}
            help={copy.help}
            scope="allAccounts"
            error={saveFailed ? t(`${NS}.saveFailed`) : undefined}
            control={
              <SwitchControl
                checked={enabled}
                onChange={(on) => {
                  if (busy) return;
                  if (on) void write(true);
                  else setAsking(true);
                }}
              />
            }
          />
        )}
        {loadFailed && <ErrorLine>{t(`${NS}.loadFailed`)}</ErrorLine>}
      </SettingRows>
      <ConfirmDialog
        open={asking}
        {...off}
        busy={busy}
        onConfirm={() => void write(false)}
        onCancel={() => setAsking(false)}
      />
    </SectionCard>
  );
}
