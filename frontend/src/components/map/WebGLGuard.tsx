import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type JSX,
  type ReactNode,
} from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { disableMapReuse } from "../../lib/mapReuse";
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

/** A lost context is rebuilt this long after the loss, so the browser can settle first. */
export const WEBGL_REMOUNT_DELAY_MS = 400;
/** This many losses inside the window mean the GPU is not coming back on its own. */
export const WEBGL_MAX_LOSSES = 3;
export const WEBGL_LOSS_WINDOW_MS = 30_000;

type Phase = "ok" | "rebuilding" | "gaveUp";

function WebGLLostNotice({
  className,
  gaveUp,
  onRetry,
}: {
  className?: string;
  gaveUp: boolean;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useTranslation(["map"]);
  return (
    <div
      role="alert"
      data-testid="webgl-lost"
      className={
        className ??
        "flex h-full min-h-32 w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm"
      }
      style={{ color: "var(--text-secondary)" }}
    >
      <span>{gaveUp ? t("map:webglLostGaveUp") : t("map:webglLost")}</span>
      {gaveUp && (
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer rounded-sm border px-3 py-1 text-xs"
          style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
        >
          {t("map:webglLostRetry")}
        </button>
      )}
    </div>
  );
}

/**
 * Wraps a map surface. Without a WebGL2 context the map is replaced by a
 * plain message and the rest of the page (lists, stats, tables) keeps
 * working; MapLibre would otherwise throw `GPUInitializationError` and the
 * page ends in the crash screen (forgejo#332).
 *
 * The probe runs at mount, not import: a context the browser refused a
 * minute ago may be available now, and one it gave at start may be gone.
 *
 * A context that is lost WHILE the map runs (a driver reset, or the browser
 * dropping the oldest context once its budget of 8-16 is spent) leaves a
 * canvas that never draws again. The guard hears `webglcontextlost` on any
 * canvas below it, says so, throws the map away (which releases its context)
 * and builds a fresh one; after `WEBGL_MAX_LOSSES` inside the window it stops
 * and offers a button instead of looping against a GPU that is not there.
 */
export default function WebGLGuard({
  children,
  className,
}: {
  children: ReactNode;
  /** Replaces the default notice box classes where the map has its own frame. */
  className?: string;
}): JSX.Element {
  const [ok, setOk] = useState(probeWebGL2);
  const [phase, setPhase] = useState<Phase>("ok");
  const [generation, setGeneration] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lossTimes = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rebuild = useCallback((): void => {
    setOk(probeWebGL2());
    setGeneration((g) => g + 1);
    setPhase("ok");
  }, []);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return undefined;
    // `webglcontextlost` does not bubble, so it is heard in the capture phase.
    const onLost = (event: Event): void => {
      if (!(event.target instanceof HTMLCanvasElement)) return;
      const now = Date.now();
      lossTimes.current = [...lossTimes.current, now].filter((t) => now - t < WEBGL_LOSS_WINDOW_MS);
      disableMapReuse();
      logger.warn("Map WebGL context was lost", { losses: lossTimes.current.length });
      if (timer.current) clearTimeout(timer.current);
      if (lossTimes.current.length >= WEBGL_MAX_LOSSES) {
        setPhase("gaveUp");
        return;
      }
      setPhase("rebuilding");
      timer.current = setTimeout(rebuild, WEBGL_REMOUNT_DELAY_MS);
    };
    el.addEventListener("webglcontextlost", onLost, true);
    return () => {
      el.removeEventListener("webglcontextlost", onLost, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [rebuild]);

  const retry = useCallback((): void => {
    lossTimes.current = [];
    rebuild();
  }, [rebuild]);

  let body: ReactNode;
  if (!ok) body = <WebGLUnavailableNotice className={className} />;
  else if (phase !== "ok")
    body = <WebGLLostNotice className={className} gaveUp={phase === "gaveUp"} onRetry={retry} />;
  else
    body = (
      <WebGLErrorBoundary
        key={generation}
        fallback={<WebGLUnavailableNotice className={className} />}
      >
        {children}
      </WebGLErrorBoundary>
    );
  // `display: contents` keeps the wrapper out of the layout: the map's own
  // frame still sizes against the guard's parent, exactly as before.
  return (
    <div ref={wrapperRef} style={{ display: "contents" }}>
      {body}
    </div>
  );
}
