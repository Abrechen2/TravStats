import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import Button from "../components/ui/Button";
import { useTranslation } from "../hooks/useTranslation";

/**
 * Catch-all page for unknown routes. Without it, hard-loading a path that
 * matches no route left the app shell empty (blank screen). Renders the nav
 * plus a friendly 404 message and a way back to the dashboard.
 */
export default function NotFoundPage(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useTranslation("common");

  return (
    <AppShell width="reading">
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <div className="text-6xl font-bold text-(--accent)">404</div>
        <h1 className="t-screen-title">{t("notFound.title")}</h1>
        <p className="text-sm text-(--text-muted)">{t("notFound.message")}</p>
        <div className="mt-2">
          <Button
            onClick={(): void => {
              // react-router 7 widened navigate() to void | Promise<void>.
              void navigate("/dashboard");
            }}
          >
            {t("notFound.back")}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
