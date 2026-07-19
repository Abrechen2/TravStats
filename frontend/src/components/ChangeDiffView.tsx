/**
 * Change Diff View Component
 *
 * Visual representation of changes between original and proposed data
 */

import { useState } from "react";
import { useTranslation } from "../hooks/useTranslation";

interface ChangeEntry {
  field: string;
  type: "added" | "removed" | "changed";
  oldValue: string | number | boolean | null | undefined;
  newValue: string | number | boolean | null | undefined;
}

interface ChangeDiffViewProps {
  original: Record<string, unknown>;
  proposed: Record<string, unknown>;
  changes: ChangeEntry[];
}

export default function ChangeDiffView({ changes }: ChangeDiffViewProps): JSX.Element {
  const { t } = useTranslation(["pendingUpdates"]);
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  const toggleField = (field: string) => {
    const newExpanded = new Set(expandedFields);
    if (newExpanded.has(field)) {
      newExpanded.delete(field);
    } else {
      newExpanded.add(field);
    }
    setExpandedFields(newExpanded);
  };

  const getChangeIcon = (type: string) => {
    switch (type) {
      case "added":
        return <span className="text-green-600 font-bold">+</span>;
      case "removed":
        return <span className="text-red-600 font-bold">−</span>;
      case "changed":
        return <span className="text-yellow-600 font-bold">~</span>;
      default:
        return null;
    }
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "string" && value.includes("T")) {
      return new Date(value).toLocaleString();
    }
    return String(value);
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-(--text-primary)">
        {t("pendingUpdates:changes.detailed")}
      </h4>
      <div className="space-y-2">
        {changes.map((change, index) => {
          const isExpanded = expandedFields.has(change.field);
          return (
            <div
              key={index}
              className="border rounded-lg p-3 border-border bg-(--bg-surface)"
            >
              <button
                onClick={() => toggleField(change.field)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-2">
                  {getChangeIcon(change.type)}
                  <span className="font-medium text-(--text-primary)">{change.field}</span>
                </div>
                <svg
                  className={`w-4 h-4 text-(--text-muted) transition-transform ${
                    isExpanded ? "transform rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {isExpanded && (
                <div className="mt-3 space-y-2 pt-3 border-t border-border">
                  <div>
                    <div className="text-xs text-(--text-muted) mb-1">
                      {t("pendingUpdates:changes.original")}
                    </div>
                    <div className="text-sm text-red-600 line-through">
                      {formatValue(change.oldValue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-(--text-muted) mb-1">
                      {t("pendingUpdates:changes.new")}
                    </div>
                    <div className="text-sm text-green-600">{formatValue(change.newValue)}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
