import { SectionTitle } from "./SettingsShared";
import { useSettingsStore } from "../../store/settingsStore";
import { useTranslation } from "../../hooks/useTranslation";

export default function FeaturesSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const { features, setFeatures } = useSettingsStore();

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t("settings:features.title")}
        description={t("settings:features.description")}
      />
      <div
        className="rounded-lg p-4 flex items-center justify-between"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div>
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            {t("settings:features.costTracking")}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("settings:features.costTrackingDesc")}
          </p>
        </div>
        <button
          onClick={() => setFeatures({ enableCostTracking: !features.enableCostTracking })}
          aria-label={t("settings:features.costTracking")}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden ${
            features.enableCostTracking ? "bg-(--accent)" : "bg-gray-600"
          }`}
          role="switch"
          aria-checked={features.enableCostTracking}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              features.enableCostTracking ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      <div
        className="rounded-lg p-4 flex items-center justify-between"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div>
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            {t("settings:features.trackAircraft")}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("settings:features.trackAircraftDesc")}
          </p>
        </div>
        <button
          onClick={() =>
            setFeatures({ trackAircraftRegistration: !features.trackAircraftRegistration })
          }
          aria-label={t("settings:features.trackAircraft")}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden ${
            features.trackAircraftRegistration ? "bg-(--accent)" : "bg-gray-600"
          }`}
          role="switch"
          aria-checked={features.trackAircraftRegistration}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              features.trackAircraftRegistration ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
