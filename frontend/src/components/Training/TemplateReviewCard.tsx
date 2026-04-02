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
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-blue-900 dark:text-blue-100">
            {t("training:templateDerived")}: <span className="font-bold">{template.name}</span>
          </p>
          <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
            Status:{" "}
            <span
              className={
                template.status === "active"
                  ? "text-green-600 dark:text-green-400"
                  : "text-yellow-600 dark:text-yellow-400"
              }
            >
              {template.status}
            </span>
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-blue-400 hover:text-blue-600"
          aria-label={t("common:dismiss")}
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        {template.status !== "active" && (
          <button
            onClick={handleActivate}
            className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
          >
            {t("training:activate")}
          </button>
        )}
        {template.status === "active" && (
          <button
            onClick={handleDisable}
            className="rounded bg-gray-400 px-3 py-1 text-sm text-white hover:bg-gray-500"
          >
            {t("training:deactivate")}
          </button>
        )}
      </div>
    </div>
  );
}
