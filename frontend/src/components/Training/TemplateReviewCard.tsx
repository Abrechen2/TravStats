import { useState, useEffect } from "react";
import { parserTemplatesApi, type UserTemplateItem } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface TemplateReviewCardProps {
  templateId: string;
  onDismiss: () => void;
}

export default function TemplateReviewCard({
  templateId,
  onDismiss,
}: TemplateReviewCardProps): JSX.Element | null {
  const { t } = useTranslation(["training", "common"]);
  const [template, setTemplate] = useState<UserTemplateItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTemplate(): Promise<void> {
      try {
        const found = await parserTemplatesApi.getById(templateId);
        setTemplate(found);
      } catch (err: unknown) {
        logger.error({ err }, "TemplateReviewCard: failed to load template");
        setTemplate(null);
      } finally {
        setLoading(false);
      }
    }
    void loadTemplate();
  }, [templateId]);

  const handleActivate = async (): Promise<void> => {
    if (!template) return;
    try {
      await parserTemplatesApi.setStatus(template.id, "active");
      setTemplate({ ...template, status: "active" });
    } catch (err: unknown) {
      logger.error({ err }, "TemplateReviewCard: failed to activate template");
    }
  };

  const handleDisable = async (): Promise<void> => {
    if (!template) return;
    try {
      await parserTemplatesApi.setStatus(template.id, "disabled");
      setTemplate({ ...template, status: "disabled" });
    } catch (err: unknown) {
      logger.error({ err }, "TemplateReviewCard: failed to disable template");
    }
  };

  if (loading) return null;
  if (!template) return null;

  return (
    <div
      className="mt-4 rounded-lg p-4"
      style={{
        background: "var(--accent-soft)",
        border: "1px solid rgba(240,169,71,0.35)",
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            {t("training:templateDerived")}: <span className="font-bold">{template.name}</span>
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Status:{" "}
            <span
              style={{
                color: template.status === "active" ? "var(--success)" : "var(--warning)",
              }}
            >
              {template.status}
            </span>
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
          aria-label={t("common:dismiss")}
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        {template.status !== "active" && (
          <button
            onClick={handleActivate}
            className="rounded-sm px-3 py-1 text-sm text-white"
            style={{ background: "var(--success)" }}
          >
            {t("training:activate")}
          </button>
        )}
        {template.status === "active" && (
          <button
            onClick={handleDisable}
            className="rounded-sm px-3 py-1 text-sm"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-muted)",
            }}
          >
            {t("training:deactivate")}
          </button>
        )}
      </div>
    </div>
  );
}
