import { Component, useState, type ErrorInfo, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { isWebGLInitError, probeWebGL2 } from "../../lib/webgl2";

/** The one message every map surface shows when it cannot get a WebGL2 context. */
export function WebGLUnavailableNotice({ className }: { className?: string }): JSX.Element {
  const { t } = useTranslation(["map"]);
  return (
    <div
      role="alert"
      data-testid="webgl-unavailable"
      className={
        className ??
        "flex h-full min-h-32 w-full items-center justify-center p-4 text-center text-sm"
      }
      style={{ color: "var(--text-secondary)" }}
    >
      {t("map:webglUnavailable")}
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}
interface BoundaryState {
  error: Error | null;
}

/**
 * Catches only the WebGL initialisation failure; anything else is rethrown
 * from render so it reaches the app's own boundary unchanged.
 */
class WebGLErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isWebGLInitError(error)) {
      logger.warn("Map WebGL context could not be created", {
        message: error.message,
        componentStack: info?.componentStack,
      });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isWebGLInitError(error)) return this.props.fallback;
    throw error;
  }
}

/**
 * Wraps a map surface. Without a WebGL2 context the map is replaced by a
 * plain message and the rest of the page (lists, stats, tables) keeps
 * working; MapLibre would otherwise throw `GPUInitializationError` and the
 * page ends in the crash screen (forgejo#332).
 *
 * The probe runs at mount, not import: a context the browser refused a
 * minute ago may be available now, and one it gave at start may be gone.
 */
export default function WebGLGuard({
  children,
  className,
}: {
  children: ReactNode;
  /** Replaces the default notice box classes where the map has its own frame. */
  className?: string;
}): JSX.Element {
  const [ok] = useState(probeWebGL2);
  const notice = <WebGLUnavailableNotice className={className} />;
  if (!ok) return notice;
  return <WebGLErrorBoundary fallback={notice}>{children}</WebGLErrorBoundary>;
}
