import { useCallback, useRef, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { ErrorLine, LinkButton } from "../../ui/settings";

/**
 * One button-shaped row's work (create a zone, revoke a key, delete days): it
 * is busy while it runs, and a refusal stays under the row in the first person
 * with "Erneut versuchen" — the choice is never dropped, the toast never
 * replaces the row (settings rebuild rule: every write retries per row).
 */
export function useRowAction(describe: (err: unknown) => string): {
  busy: boolean;
  error: string | null;
  /** Runs `work`; resolves true when it did not throw. */
  run: (work: () => Promise<void>) => Promise<boolean>;
  retry: () => void;
  clear: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<(() => Promise<void>) | null>(null);
  const describeRef = useRef(describe);
  describeRef.current = describe;

  const run = useCallback(async (work: () => Promise<void>): Promise<boolean> => {
    last.current = work;
    setBusy(true);
    setError(null);
    try {
      await work();
      last.current = null;
      return true;
    } catch (err) {
      logger.warn("Settings row action failed", err);
      setError(describeRef.current(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const retry = useCallback((): void => {
    const work = last.current;
    if (work) void run(work);
  }, [run]);

  const clear = useCallback((): void => {
    last.current = null;
    setError(null);
  }, []);

  return { busy, error, run, retry, clear };
}

/** The refusal line of a row action, with its retry. */
export function RowFailure({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  if (!error) return null;
  return (
    <ErrorLine>
      {error}{" "}
      {onRetry ? (
        <LinkButton onClick={onRetry}>{t("settings:blocks.save.retry")}</LinkButton>
      ) : null}
    </ErrorLine>
  );
}
