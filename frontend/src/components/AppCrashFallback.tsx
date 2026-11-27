import type { JSX } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { Icon } from "./ui/Icon";

/** The whole app crashed: say so and offer a reload (moved out of App.tsx). */
export default function AppCrashFallback(): JSX.Element {
  const { t } = useTranslation("common");
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--bg-base)" }}
    >
      <div
        className="max-w-md w-full p-8 rounded-xl"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <Icon name="circle-alert" size={24} />
          </div>
          <h1 className="t-screen-title mb-2">{t("errorBoundary.title")}</h1>
          <p className="mb-6" style={{ color: "var(--text-muted)" }}>
            {t("errorBoundary.message")}
          </p>
          <button onClick={() => window.location.reload()} className="btn-primary w-full px-6 py-3">
            {t("errorBoundary.refresh")}
          </button>
        </div>
      </div>
    </div>
  );
}
