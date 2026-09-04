import { useEffect, useState } from "react";
import { templateApi } from "../lib/api";
import type { TemplateStatusEntry } from "../lib/api";
import { logger } from "../lib/logger";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";

export default function TemplateStatusView(): JSX.Element {
  const { t } = useTranslation(["parser"]);
  // The refresh replaces the registry every user parses with, so the server
  // only accepts it from an admin (forgejo#67). Drawing the button for anyone
  // else would offer an action that always ends in 403.
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  const [templates, setTemplates] = useState<TemplateStatusEntry[]>([]);
  const [githubRepo, setGithubRepo] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = (): void => {
    void templateApi
      .getStatus()
      .then((data) => {
        setTemplates(data.templates);
        setGithubRepo(data.githubRepo);
      })
      .catch((err: unknown) => logger.error("Failed to load template status", err))
      .finally(() => setLoading(false));
  };

  useEffect(loadStatus, []);

  const handleSync = (): void => {
    setSyncing(true);
    void templateApi
      .sync()
      .then((data) => {
        setTemplates(data.templates);
        setGithubRepo(data.githubRepo);
      })
      .catch((err: unknown) => logger.error("Template sync failed", err))
      .finally(() => setSyncing(false));
  };

  if (loading) {
    return <div className="text-slate-400 text-sm">{t("parser:communityTemplates.status.loading")}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-200">{t("parser:communityTemplates.status.title")}</h3>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing
                ? t("parser:communityTemplates.status.syncing")
                : t("parser:communityTemplates.status.sync")}
            </button>
          )}
          {githubRepo && (
            <a
              href={`${githubRepo}/blob/main/README.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              {t("parser:communityTemplates.status.addTemplate")}
            </a>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {templates.map((tpl) => (
          <div
            key={tpl.iata}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2"
          >
            <span className="font-mono text-blue-400 shrink-0">{tpl.iata}</span>
            <span className="text-slate-300 truncate flex-1">{tpl.airline}</span>
            <span className="text-xs text-slate-500 shrink-0">v{tpl.version.slice(0, 7)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {t("parser:communityTemplates.status.loaded", { count: templates.length })}
        {!isAdmin && <> · {t("parser:communityTemplates.status.adminOnly")}</>}
      </p>
    </div>
  );
}
