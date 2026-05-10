import { Component, ErrorInfo, ReactNode } from "react";
import i18n from "../i18n/config";

// #region agent log
const debugLog = (
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  hypothesisId?: string
): void => {
  // Only log in development mode
  if (import.meta.env.MODE !== "development") {
    return;
  }

  // Development-only console logging
  console.log(`[DEBUG ${hypothesisId || "?"}] ${location}: ${message}`, data);

  // Store in localStorage for development debugging (max 100 entries)
  try {
    const logEntry = {
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: "debug-session",
      runId: "run1",
      hypothesisId,
    };
    const stored = localStorage.getItem("debug-logs") || "[]";
    const logs = JSON.parse(stored);
    logs.push(logEntry);
    if (logs.length > 100) logs.shift();
    localStorage.setItem("debug-logs", JSON.stringify(logs));
  } catch {
    // Ignore localStorage errors
  }
};
// #endregion

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // #region agent log
    debugLog(
      "ErrorBoundary.tsx:getDerivedStateFromError",
      "Error caught by boundary",
      {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
      "A"
    );
    // #endregion
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (import.meta.env.MODE === "development") {
      console.error("Error caught by boundary:", error, errorInfo);
    }
    // #region agent log
    debugLog(
      "ErrorBoundary.tsx:componentDidCatch",
      "Error details captured",
      {
        message: error.message,
        name: error.name,
        stack: error.stack,
        componentStack: errorInfo?.componentStack,
      },
      "A"
    );
    // #endregion
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className="p-4 rounded-lg"
          style={{
            background: "rgba(248,81,73,0.10)",
            border: "1px solid rgba(248,81,73,0.35)",
          }}
        >
          <h3 className="font-semibold mb-2" style={{ color: "var(--danger)" }}>
            {i18n.t("common:errorBoundary.fallbackTitle")}
          </h3>
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {this.state.error?.message || i18n.t("common:errorBoundary.fallbackMessage")}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="mt-3 px-4 py-2 rounded text-white"
            style={{ background: "var(--danger)" }}
          >
            {i18n.t("common:errorBoundary.tryAgain")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
