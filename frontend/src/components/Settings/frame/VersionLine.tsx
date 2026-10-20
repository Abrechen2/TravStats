import type { JSX } from "react";
import { version as pkgVersion } from "../../../../package.json";
import { useTranslation } from "../../../hooks/useTranslation";

/**
 * "TravStats 2.7.0" under the settings menu. "Über TravStats" moved to
 * Administration › Instanz (tester, 2026-10-20), and the version was the one
 * thing in it every account needs — to say which build a bug report is about.
 * The bundled version, not a request: this line must not cost a round trip on
 * every settings page.
 */
export function VersionLine(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <p
      className="t-caption"
      data-testid="settings-version"
      style={{ padding: "0 var(--ts-space-md)", fontFamily: "var(--ts-font-mono)" }}
    >
      {t("settings:menu.version", { version: pkgVersion })}
    </p>
  );
}
