import { useEffect, useState } from "react";
import { api } from "../../lib/api/client";
import { version as pkgVersion } from "../../../package.json";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { SettingRow, SettingRows } from "../ui/SettingRow";

const REPO_URL = "https://github.com/Abrechen2/TravStats";
const DONATE_URL = "https://www.paypal.com/donate?hosted_button_id=GLXYTD3FV9Y78";

export default function AboutSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  // Backend reports two versions:
  //   appVersion  — the clean display version (e.g. `1.0.1`)
  //   buildVersion — the baked image version, carrying any RC/beta
  //                  suffix. Only rendered when it differs, so users
  //                  know when a promoted RC image is running.
  // Falls back to the bundled package.json during first render.
  const [appVersion, setAppVersion] = useState<string>(pkgVersion);
  const [buildVersion, setBuildVersion] = useState<string>("");
  useEffect(() => {
    api
      .get<{ version: string; buildVersion?: string }>("/version")
      .then(({ data }) => {
        if (data?.version && data.version !== "unknown") setAppVersion(data.version);
        if (data?.buildVersion && data.buildVersion !== "unknown") {
          setBuildVersion(data.buildVersion);
        }
      })
      .catch(() => {
        // stick with package.json fallback
      });
  }, []);

  const showBuild = buildVersion && buildVersion !== appVersion;

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:about.title")}
        badge={
          <>
            <span
              className="font-mono"
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 6,
                background: "var(--ts-tile)",
                color: "var(--ts-muted)",
              }}
            >
              v{appVersion}
            </span>
            {showBuild && (
              <span
                className="font-mono"
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "var(--ts-tile)",
                  color: "var(--ts-muted)",
                }}
                title={t("settings:about.buildVersionHint")}
              >
                {t("settings:about.buildLabel")}: {buildVersion}
              </span>
            )}
          </>
        }
      />
      <SettingRows>
        <SettingRow
          title="TravStats"
          sub={t("settings:about.tagline")}
          control={
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              {t("settings:about.sourceCode")}
            </a>
          }
        />
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <SettingRow
            title={t("settings:about.licenseTitle")}
            sub={t("settings:about.licenseSub")}
          />
          <p className="t-caption">{t("settings:about.licenseBody")}</p>
        </div>
        <SettingRow
          title={t("settings:about.supportTitle")}
          sub={t("settings:about.supportSub")}
          control={
            <>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                {t("settings:about.star")}
              </a>
              <a
                href={DONATE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                {t("settings:about.donate")}
              </a>
            </>
          }
        />
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <SettingRow title={t("settings:about.dataSources.title")} />
          <ul className="t-caption flex flex-col" style={{ gap: 4 }}>
            <li>
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                © OpenStreetMap contributors
              </a>{" "}
              — {t("settings:about.dataSources.osm")}
            </li>
            <li>
              <a
                href="https://github.com/eurostat/searoute"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Eurostat SeaRoute
              </a>{" "}
              — {t("settings:about.dataSources.searoute")}
            </li>
            <li>
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Open-Meteo.com
              </a>{" "}
              — {t("settings:about.dataSources.openMeteo")}
            </li>
            <li>
              <a
                href="https://www.wikipedia.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Wikipedia / Wikidata
              </a>{" "}
              — {t("settings:about.dataSources.wikipedia")}
            </li>
            <li>
              <a
                href="https://github.com/trainline-eu/stations"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Trainline stations
              </a>{" "}
              — {t("settings:about.dataSources.trainline")}
            </li>
            <li>
              <a
                href="https://transitous.org/sources/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Transitous
              </a>{" "}
              — {t("settings:about.dataSources.transitous")}
            </li>
            <li>
              <a
                href={`${REPO_URL}#third-party-data-and-assets`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {t("settings:about.dataSources.fullList")}
              </a>
            </li>
          </ul>
        </div>
      </SettingRows>
    </SectionCard>
  );
}
