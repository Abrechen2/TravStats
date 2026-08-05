import { useEffect, useState } from "react";
import { api } from "../../lib/api/client";
import { version as pkgVersion } from "../../../package.json";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";

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
      <div className="flex items-baseline gap-3 mb-1 flex-wrap">
        <SectionTitle title="About TravStats" />
        <span
          className="text-sm font-mono px-2 py-0.5 rounded-sm"
          style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
        >
          v{appVersion}
        </span>
        {showBuild && (
          <span
            className="text-xs font-mono px-2 py-0.5 rounded-sm"
            style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
            title={t("settings:about.buildVersionHint")}
          >
            {t("settings:about.buildLabel")}: {buildVersion}
          </span>
        )}
      </div>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        TravStats - Flight Statistics Tracking Application
      </p>
      <div className="rounded-lg p-4" style={{ background: "var(--bg-elevated)" }}>
        <p className="text-sm mb-2" style={{ color: "var(--text-primary)" }}>
          <strong>License:</strong> GNU Affero General Public License v3.0 (AGPL-3.0)
        </p>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Copyright © 2025 Dennis Wittke
        </p>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          This program is free software: you can redistribute it and/or modify it under the terms of
          the GNU Affero General Public License. If you run this software as a web service, you must
          make the complete source code available under AGPL-3.0.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/Abrechen2/TravStats"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 font-medium rounded-lg text-sm transition-colors"
            style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            Source Code
          </a>
          <a
            href="https://github.com/Abrechen2/TravStats"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 font-medium rounded-lg text-sm transition-all"
            style={{
              background: "rgba(245,166,35,0.08)",
              color: "#f5a623",
              border: "1px solid rgba(245,166,35,0.3)",
            }}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            Star on GitHub
          </a>
          <a
            href="https://www.paypal.com/donate?hosted_button_id=GLXYTD3FV9Y78"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 font-medium rounded-lg text-sm transition-all"
            style={{
              background: "rgba(232,93,138,0.08)",
              color: "#e85d8a",
              border: "1px solid rgba(232,93,138,0.3)",
            }}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            Spenden via PayPal
          </a>
        </div>
      </div>
      <div className="mt-4 rounded-lg p-4" style={{ background: "var(--bg-elevated)" }}>
        <p className="text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
          {t("settings:about.dataSources.title")}
        </p>
        <ul className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
          <li>
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              © OpenStreetMap contributors
            </a>{" "}
            — map tiles (ODbL 1.0)
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
            — cruise ocean-leg distances (EUPL-1.2 / ORNL Global Shipping Lane Network, public
            domain)
          </li>
          <li>
            <a
              href="https://github.com/Abrechen2/TravStats/blob/main/LICENSES.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {t("settings:about.dataSources.fullList")}
            </a>
          </li>
        </ul>
      </div>
    </SectionCard>
  );
}
