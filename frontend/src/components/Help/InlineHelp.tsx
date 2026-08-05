import { useState, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";

interface InlineHelpProps {
  title: string;
  content: ReactNode;
  category?: "basic" | "advanced" | "expert";
  className?: string;
}

const categoryColors = {
  basic: "border-border",
  advanced: "border-(--accent)",
  expert: "border-(--warning)",
};

const categoryIcons = {
  basic: "💡",
  advanced: "⚙️",
  expert: "🔧",
};

export default function InlineHelp({
  title,
  content,
  category = "basic",
  className = "",
}: InlineHelpProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation("common");

  return (
    <div className={`rounded-lg border p-4 ${categoryColors[category]} ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-xl">{categoryIcons[category]}</span>
          <div className="flex-1">
            <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
              {title}
            </h3>
            {isExpanded && (
              <div className="text-sm mt-2 space-y-2" style={{ color: "var(--text-muted)" }}>
                {content}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-4 text-sm font-medium whitespace-nowrap"
          style={{ color: "var(--accent)" }}
        >
          {isExpanded ? t("help.less") : t("help.more")}
        </button>
      </div>
    </div>
  );
}
