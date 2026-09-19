import { useEffect, useState } from "react";
import { parserTemplatesApi, type UserTemplateItem } from "../../lib/api";
import type { TemplatePreviewResult } from "../../lib/api/types";
import TemplatePreviewPanel from "./TemplatePreviewPanel";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { GlobeLoader } from "../GlobeLoader";
import { useMinLoadingState } from "../../hooks/useMinLoadingState";
import { formatDate } from "../../lib/displayFormat";

export default function MyTemplates(): JSX.Element {
  const { t } = useTranslation(["parser", "common"]);
  const [templates, setTemplates] = useState<UserTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const showLoader = useMinLoadingState(loading, 2000);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  /** The preview of each template the user has run, by template id. */
  const [previews, setPreviews] = useState<Record<string, TemplatePreviewResult>>({});
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

  const handlePreview = async (id: string): Promise<void> => {
    setActionLoading(id);
    try {
      const preview = await parserTemplatesApi.preview(id);
      setPreviews((prev) => ({ ...prev, [id]: preview }));
    } catch (err: unknown) {
      logger.error({ err }, "MyTemplates: failed to preview");
      addToast("error", t("parser:preview.failed"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetStatus = async (id: string, status: "active" | "disabled"): Promise<void> => {
    setActionLoading(id);
    try {
      await parserTemplatesApi.setStatus(id, status);
      setTemplates((prev) => prev.map((tmpl) => (tmpl.id === id ? { ...tmpl, status } : tmpl)));
    } catch (err: unknown) {
      logger.error({ err }, "MyTemplates: failed to set status");
      // The server refuses an un-previewed activation with its own code, and
      // the answer to that is "run the preview" — not the generic failure
      // toast, which would read as a bug in the page (forgejo#124 phase 6).
      const code =
        typeof err === "object" && err !== null
          ? (err as { response?: { data?: { code?: string } } }).response?.data?.code
          : undefined;
      addToast(
        "error",
        code === "PREVIEW_REQUIRED"
          ? t("parser:preview.requiredFirst")
          : t("parser:myTemplates.setStatusError")
      );
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
    // Status badges use brand state tokens (--success / --warning / muted
    // surface) instead of light-mode tailwind variants. Per BRAND.md state
    // colours are global tokens, not light-mode-only paint.
    const styles: Record<UserTemplateItem["status"], { bg: string; fg: string }> = {
      active: { bg: "rgba(63,185,80,0.15)", fg: "var(--success)" },
      pending: { bg: "rgba(210,153,34,0.15)", fg: "var(--warning)" },
      disabled: { bg: "var(--bg-elevated)", fg: "var(--text-muted)" },
    };
    const s = styles[status];
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: s.bg, color: s.fg }}
      >
        {t(`parser:myTemplates.status.${status}`)}
      </span>
    );
  };

  if (showLoader) {
    return (
      <div className="flex justify-center py-12">
        <GlobeLoader size={140} label={t("common:loading.default")} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-(--danger)">
        <p className="text-lg font-medium">{t(error)}</p>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-16 text-(--text-muted)">
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
          className="rounded-lg px-5 py-4"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-(--text-primary) truncate">{tmpl.name}</span>
                {statusBadge(tmpl.status)}
                {/* Which parser may use it at all. A lodging template is never
                  tried on a flight mail, and the badge is where that stops
                  being invisible (forgejo#124 phase 6). */}
                <span className="text-xs text-(--text-muted)">
                  {t(`parser:domains.${tmpl.domain ?? "flight"}`)}
                </span>
              </div>
              <div className="text-xs text-(--text-muted) flex gap-4">
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
                  {t("parser:myTemplates.created")} {formatDate(tmpl.createdAt)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {tmpl.status === "disabled" || tmpl.status === "pending" ? (
                <>
                  <button
                    data-testid={`preview-${tmpl.id}`}
                    onClick={() => void handlePreview(tmpl.id)}
                    disabled={actionLoading === tmpl.id}
                    className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                    style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
                  >
                    {t("parser:preview.run")}
                  </button>
                  <button
                    data-testid={`activate-${tmpl.id}`}
                    onClick={() => handleSetStatus(tmpl.id, "active")}
                    // Activation is refused server-side until a preview has
                    // passed; disabling the button says so before the click
                    // rather than answering it with an error.
                    disabled={actionLoading === tmpl.id || previews[tmpl.id]?.canActivate !== true}
                    className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                  >
                    {t("parser:myTemplates.activate")}
                  </button>
                </>
              ) : (
                <button
                  data-testid={`disable-${tmpl.id}`}
                  onClick={() => handleSetStatus(tmpl.id, "disabled")}
                  disabled={actionLoading === tmpl.id}
                  className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
                >
                  {t("parser:myTemplates.disable")}
                </button>
              )}
              <button
                data-testid={`delete-${tmpl.id}`}
                onClick={() => handleDelete(tmpl.id)}
                disabled={actionLoading === tmpl.id}
                className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                style={{ background: "rgba(248,81,73,0.12)", color: "var(--danger)" }}
              >
                {t("common:buttons.delete")}
              </button>
            </div>
          </div>
          {previews[tmpl.id] && <TemplatePreviewPanel preview={previews[tmpl.id]} />}
        </div>
      ))}
    </div>
  );
}
