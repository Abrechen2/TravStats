import { useEffect, useState } from "react";
import { parserTemplatesApi, type UserTemplateItem } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";

export default function MyTemplates(): JSX.Element {
  const { t } = useTranslation(["parser", "common"]);
  const [templates, setTemplates] = useState<UserTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const addToast = useToastStore((state) => state.addToast);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const result = await parserTemplatesApi.list();
        setTemplates(result);
      } catch (err: unknown) {
        logger.error({ err }, "MyTemplates: failed to load");
        setError("parser:myTemplates.loadError");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleSetStatus = async (id: string, status: "active" | "disabled"): Promise<void> => {
    setActionLoading(id);
    try {
      await parserTemplatesApi.setStatus(id, status);
      setTemplates((prev) => prev.map((tmpl) => (tmpl.id === id ? { ...tmpl, status } : tmpl)));
    } catch (err: unknown) {
      logger.error({ err }, "MyTemplates: failed to set status");
      addToast("error", t("parser:myTemplates.setStatusError"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm(t("parser:myTemplates.confirmDelete"))) return;
    setActionLoading(id);
    try {
      await parserTemplatesApi.delete(id);
      setTemplates((prev) => prev.filter((tmpl) => tmpl.id !== id));
    } catch (err: unknown) {
      logger.error({ err }, "MyTemplates: failed to delete");
      addToast("error", t("parser:myTemplates.deleteError"));
    } finally {
      setActionLoading(null);
    }
  };

  const statusBadge = (status: UserTemplateItem["status"]): JSX.Element => {
    const styles: Record<UserTemplateItem["status"], string> = {
      active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      disabled: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}>
        {t(`parser:myTemplates.status.${status}`)}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-red-500 dark:text-red-400">
        <p className="text-lg font-medium">{t(error)}</p>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500 dark:text-gray-400">
        <div className="text-4xl mb-4">🧩</div>
        <p className="text-lg font-medium">{t("parser:myTemplates.empty")}</p>
        <p className="text-sm mt-1">{t("parser:myTemplates.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {templates.map((tmpl) => (
        <div
          key={tmpl.id}
          className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center justify-between gap-4"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-gray-900 dark:text-white truncate">
                {tmpl.name}
              </span>
              {statusBadge(tmpl.status)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex gap-4">
              {tmpl.stats && (
                <>
                  <span>
                    {tmpl.stats.matchCount} {t("parser:myTemplates.matches")}
                  </span>
                  <span>
                    {Math.round(tmpl.stats.successRate * 100)}%{" "}
                    {t("parser:myTemplates.successRate")}
                  </span>
                </>
              )}
              <span>
                {t("parser:myTemplates.created")} {new Date(tmpl.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {tmpl.status === "disabled" || tmpl.status === "pending" ? (
              <button
                data-testid={`activate-${tmpl.id}`}
                onClick={() => handleSetStatus(tmpl.id, "active")}
                disabled={actionLoading === tmpl.id}
                className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors"
              >
                {t("parser:myTemplates.activate")}
              </button>
            ) : (
              <button
                data-testid={`disable-${tmpl.id}`}
                onClick={() => handleSetStatus(tmpl.id, "disabled")}
                disabled={actionLoading === tmpl.id}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                {t("parser:myTemplates.disable")}
              </button>
            )}
            <button
              data-testid={`delete-${tmpl.id}`}
              onClick={() => handleDelete(tmpl.id)}
              disabled={actionLoading === tmpl.id}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
            >
              {t("common:buttons.delete")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
