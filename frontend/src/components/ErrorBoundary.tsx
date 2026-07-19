import { Component, ErrorInfo, ReactNode } from "react";
import i18n from "../i18n/config";
import { logger } from "../lib/logger";

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
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error("Error caught by boundary:", {
      message: error.message,
      name: error.name,
      stack: error.stack,
      componentStack: errorInfo?.componentStack,
    });
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
            className="mt-3 px-4 py-2 rounded-sm text-white"
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
