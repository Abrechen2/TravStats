import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
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
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-6 py-24 text-center">
        <div className="text-6xl font-bold text-(--accent)">404</div>
        <h1 className="text-xl font-semibold text-(--text-primary)">
          {t("notFound.title")}
        </h1>
        <p className="text-sm text-(--text-muted)">{t("notFound.message")}</p>
        <button
          type="button"
          onClick={(): void => {
            // react-router 7 widened navigate() to void | Promise<void>.
            void navigate("/dashboard");
          }}
          className="mt-2 rounded-md border border-border px-4 py-2 text-sm text-(--accent) hover:border-(--accent)"
        >
          {t("notFound.back")}
        </button>
      </div>
    </div>
  );
}
