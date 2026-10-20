import { useEffect, useState, type JSX } from "react";
import { versionApi } from "../../../lib/api/version";
import { logger } from "../../../lib/logger";
import { useTranslation } from "../../../hooks/useTranslation";

/**
 * "TravStats 2.7.0-rc.19" under the settings menu. "Über TravStats" moved to
 * Administration › Instanz (tester, 2026-10-20), and the version was the one
 * thing in it every account needs — to say which build a bug report is about.
 *
 * The server's answer, the same one the update badge reads: the build
 * version, which carries an RC suffix where one runs. The frontend's
 * package.json is NOT the product version (it read "1.0.0" on a 2.7 server,
 * found in the iPad browser look); until the server answers, nothing is shown
 * rather than a number that may be wrong.
 */
export function VersionLine(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const info = await versionApi.get();
        const shown =
          info.buildVersion && info.buildVersion !== "unknown" ? info.buildVersion : info.version;
        if (!cancelled && shown && shown !== "unknown") setVersion(shown);
      } catch (err) {
        logger.warn("Failed to load the version for the settings menu", err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;
  return (
    <p
      className="t-caption"
      data-testid="settings-version"
      style={{ padding: "0 var(--ts-space-md)", fontFamily: "var(--ts-font-mono)" }}
    >
      {t("settings:menu.version", { version })}
    </p>
  );
}
