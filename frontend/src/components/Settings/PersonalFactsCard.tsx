import { useEffect, useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { personalApi, type PersonalFacts } from "../../lib/api/companionData";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { SectionCard } from "./SettingsShared";
import { SettingRow, SettingRows } from "../ui/SettingRow";

/**
 * Home place and passport expiry (forgejo#398) — facts the Companion writes
 * to the server (`/settings/personal`). The passport expiry is edited here; the
 * server keeps one value and the last write wins (the endpoint has no rev), so
 * every save shows what the server answered, and a failed one keeps the stored
 * value on screen and says so.
 *
 * The home place is NOT edited here any more (plan `2026-11-01-home-one-source`):
 * it is the residence of the current home period, edited with the home periods
 * ("Zuhause"). This card shows it and links there.
 */
export default function PersonalFactsCard(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [facts, setFacts] = useState<PersonalFacts | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    personalApi
      .get()
      .then((f) => {
        if (alive) setFacts(f);
      })
      .catch((error: unknown) => {
        logger.warn("Failed to load personal facts", error);
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async (patch: Partial<PersonalFacts>): Promise<boolean> => {
    setSaving(true);
    try {
      setFacts(await personalApi.put(patch));
      return true;
    } catch (error) {
      logger.warn("Failed to save personal facts", error);
      useToastStore.getState().addToast("error", t("settings:errors.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const home = facts?.homePlace ?? null;
  return (
    <SectionCard>
      <SettingRows>
        <SettingRow
          title={t("settings:personalFacts.homePlace.label")}
          sub={
            loadFailed
              ? t("settings:personalFacts.loadFailed")
              : facts?.homePlaceSource === "legacy" && home
                ? t("settings:personalFacts.homePlace.legacyHint")
                : t("settings:personalFacts.homePlace.description")
          }
          control={
            <span className="flex flex-wrap items-center" style={{ gap: 8 }}>
              <span data-testid="home-place-value">
                {facts ? (home?.name ?? t("settings:personalFacts.notSet")) : "…"}
              </span>
              <Link
                to="/settings/flight?section=homeAirport"
                className="t-caption underline"
                data-testid="home-place-edit-link"
              >
                {t("settings:personalFacts.homePlace.editLink")}
              </Link>
            </span>
          }
        />
        <SettingRow
          title={t("settings:personalFacts.passport.label")}
          htmlFor="settings-passport-expiry"
          sub={t("settings:personalFacts.passport.description")}
          control={
            <span className="flex flex-wrap items-center" style={{ gap: 8 }}>
              <input
                id="settings-passport-expiry"
                type="date"
                className="input"
                style={{ minHeight: "var(--ts-size-touch-min)" }}
                // keyed by the stored value: a rejected save snaps back to it
                key={facts?.passportExpiry ?? "none"}
                defaultValue={facts?.passportExpiry ?? ""}
                disabled={!facts || saving}
                onBlur={(e) => {
                  // A half-typed date reads as "" too; that is not a request to clear.
                  if (e.target.value === "" && e.target.validity.badInput) return;
                  const next = e.target.value === "" ? null : e.target.value;
                  if (next === (facts?.passportExpiry ?? null)) return;
                  void save({ passportExpiry: next }).then((ok) => {
                    if (!ok) e.target.value = facts?.passportExpiry ?? "";
                  });
                }}
              />
            </span>
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
