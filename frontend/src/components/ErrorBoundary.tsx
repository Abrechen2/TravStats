import { Component, ErrorInfo, ReactNode } from "react";
import i18n from "../i18n/config";
import { logger } from "../lib/logger";
import { isChunkLoadError, tryReloadForStaleBundle } from "../lib/staleBundle";
import StaleBundleNotice from "./StaleBundleNotice";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  /** A stale-chunk failure triggered the one automatic reload. */
  staleReloading?: boolean;
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
    // A lazy route whose chunk is gone after an update (lib/staleBundle.ts):
    // reload once, guarded; if the guard holds, render() explains instead.
    if (isChunkLoadError(error)) {
      const reloading = tryReloadForStaleBundle();
      this.setState({ staleReloading: reloading });
      logger.warn("Stale bundle: a code chunk failed to load", {
        message: error.message,
        reloading,
      });
      return;
    }
    logger.error("Error caught by boundary:", {
      message: error.message,
      name: error.name,
      stack: error.stack,
      componentStack: errorInfo?.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Ahead of any fallback: the generic "something went wrong" makes an
      // update look like a crash, and its "try again" re-requests the same
      // missing chunk.
      if (isChunkLoadError(this.state.error)) {
        return <StaleBundleNotice reloading={this.state.staleReloading === true} />;
      }
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
