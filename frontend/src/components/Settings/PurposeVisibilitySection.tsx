import { useEffect, useState, type JSX } from "react";
import { DOMAINS } from "../../shared/domains";
import { PURPOSE_DOMAINS, type PurposeDomain, type PurposeVisibility } from "../../shared/purpose";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { purposeApi } from "../../lib/api/purpose";
import { logger } from "../../lib/logger";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { ActionControl, ChoiceControl, SettingItem } from "../ui/settings";

type Choice = "show" | "hideBusiness" | "hidePrivate";

const choiceOf = (hidden: readonly string[] | undefined): Choice =>
  hidden?.includes("business")
    ? "hideBusiness"
    : hidden?.includes("private")
      ? "hidePrivate"
      : "show";

const hiddenOf = (choice: Choice): PurposeVisibility[PurposeDomain] =>
  choice === "hideBusiness" ? ["business"] : choice === "hidePrivate" ? ["private"] : [];

/**
 * "Geschäftliche ausblenden" / "Private ausblenden", one row per area. The server applies it to
 * every list, map, statistic and count of the account (not a request parameter), so a choice here
 * is what the web and the app both show. A failed save is said on the row and the choice goes back.
 */
export default function PurposeVisibilitySection({
  domains,
}: {
  /** The areas the account shows; only those that carry a purpose get a row. */
  domains: readonly string[];
}): JSX.Element | null {
  const { t } = useTranslation(["purpose", "common", "settings"]);
  const isDemo = useIsDemoAccount();
  const [visibility, setVisibility] = useState<PurposeVisibility>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [filled, setFilled] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await purposeApi.visibility();
        if (!cancelled) setVisibility(state.visibility);
      } catch (error) {
        logger.warn("purpose visibility could not be loaded", error);
        if (!cancelled) setFailed("load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = PURPOSE_DOMAINS.filter((d) => domains.includes(d));
  if (rows.length === 0) return null;

  const choose = async (domain: PurposeDomain, choice: Choice): Promise<void> => {
    const next = { ...visibility, [domain]: hiddenOf(choice) };
    setFailed(null);
    try {
      const state = await purposeApi.setVisibility(next);
      setVisibility(state.visibility);
    } catch (error) {
      logger.warn("purpose visibility save failed", error);
      setFailed(domain);
    }
  };

  const fillFromTrips = async (): Promise<void> => {
    setFailed(null);
    try {
      setFilled(await purposeApi.fillFromTrips());
    } catch (error) {
      logger.warn("purpose fill from trips failed", error);
      setFailed("fill");
    }
  };

  return (
    <SectionCard>
      <h3 className="t-h3">{t("purpose:visibility.title")}</h3>
      <p className="t-caption">{t("purpose:visibility.intro")}</p>
      <SettingRows>
        {rows.map((domain) => {
          const name = t(DOMAINS[domain].i18nKey, { ns: "common" });
          return (
            <div key={domain} data-purpose-row={domain}>
              <SettingItem
                title={name}
                name={name}
                error={failed === domain ? t("purpose:visibility.error") : undefined}
                locked={
                  isDemo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined
                }
                control={
                  <ChoiceControl<Choice>
                    label={name}
                    value={choiceOf(visibility[domain])}
                    options={[
                      { value: "show", label: t("purpose:visibility.show") },
                      { value: "hideBusiness", label: t("purpose:visibility.hideBusiness") },
                      { value: "hidePrivate", label: t("purpose:visibility.hidePrivate") },
                    ]}
                    onChange={(c) => void choose(domain, c)}
                  />
                }
              />
            </div>
          );
        })}
        <SettingItem
          title={t("purpose:visibility.fromTrips")}
          name={t("purpose:visibility.fromTrips")}
          help={t("purpose:visibility.fromTripsHelp")}
          error={failed === "fill" ? t("purpose:visibility.error") : undefined}
          control={
            <ActionControl
              label={t("purpose:visibility.fromTrips")}
              onClick={() => void fillFromTrips()}
            />
          }
        >
          {filled !== null && (
            <p role="status" className="t-caption">
              {t("purpose:visibility.fromTripsDone", { count: filled })}
            </p>
          )}
        </SettingItem>
      </SettingRows>
    </SectionCard>
  );
}
