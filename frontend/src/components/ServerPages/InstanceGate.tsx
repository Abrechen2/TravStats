import { useEffect, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import { ErrorLine } from "../ui/settings";
import { useInstanceStore } from "./instanceStore";
import type { InstanceSettings } from "../../lib/api/admin";

/**
 * Loads the instance settings and draws `children` once they are there. A load
 * that failed says so and offers to try again, instead of drawing a form that
 * would save defaults over the real values.
 */
export default function InstanceGate({
  children,
}: {
  children: (settings: InstanceSettings) => ReactNode;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const settings = useInstanceStore((s) => s.settings);
  const load = useInstanceStore((s) => s.load);
  const ensureLoaded = useInstanceStore((s) => s.ensureLoaded);
  const reload = useInstanceStore((s) => s.reload);
  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  if (settings) return <>{children(settings)}</>;
  if (load === "failed") {
    return (
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <ErrorLine>{t("settingsRows:server.loadFailed")}</ErrorLine>
        <Button variant="secondary" onClick={() => void reload()}>
          {t("settingsRows:server.retry")}
        </Button>
      </div>
    );
  }
  return <div style={{ minHeight: 80 }} aria-busy="true" />;
}
