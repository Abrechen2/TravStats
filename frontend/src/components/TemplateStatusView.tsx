import { useEffect, useState } from "react";
import { templateApi } from "../lib/api";
import type { TemplateStatusEntry } from "../lib/api";
import { logger } from "../lib/logger";

export default function TemplateStatusView(): JSX.Element {
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
    return <div className="text-slate-400 text-sm">Lade Templates...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-200">Airline Email Templates</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {syncing ? "Aktualisiere..." : "Jetzt aktualisieren"}
          </button>
          {githubRepo && (
            <a
              href={`${githubRepo}/blob/main/README.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Template hinzufügen →
            </a>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {templates.map((t) => (
          <div
            key={t.iata}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2"
          >
            <span className="font-mono text-blue-400 shrink-0">{t.iata}</span>
            <span className="text-slate-300 truncate flex-1">{t.airline}</span>
            <span className="text-xs text-slate-500 shrink-0">v{t.version.slice(0, 7)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {templates.length} Templates geladen · Tägl. Auto-Update aus GitHub
      </p>
    </div>
  );
}
