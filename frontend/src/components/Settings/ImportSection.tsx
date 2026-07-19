import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Fr24ImportTile } from "../import/Fr24ImportTile";
import { GenericCsvImportTile } from "../import/GenericCsvImportTile";

/** Central import hub: one settings area, bulk importers grouped per domain.
 *  Single-record email/PDF parsing deliberately stays in the add dialogs.
 *  A future domain gets a group by adding its tiles here — nothing else. */
const BULK_IMPORTERS: Partial<Record<DomainKey, JSX.Element[]>> = {
  flight: [<Fr24ImportTile key="fr24" />, <GenericCsvImportTile key="csv" />],
};

export default function ImportSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { isEnabled } = useEnabledDomains();

  const groups = AVAILABLE_DOMAINS.filter(
    (key) => isEnabled(key) && (BULK_IMPORTERS[key]?.length ?? 0) > 0
  );

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:import.title")}
        description={t("settings:import.description")}
      />
      <div className="flex flex-col gap-6">
        {groups.map((key) => (
          <div key={key}>
            <div className="mb-3 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: DOMAINS[key].color }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-(--text-muted)">
                {t(`common:${DOMAINS[key].i18nKey}`)}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{BULK_IMPORTERS[key]}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
