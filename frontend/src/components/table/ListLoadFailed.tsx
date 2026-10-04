import EmptyState from "../ui/EmptyState";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * A logbook list that could not be read: the design system's `degraded` state —
 * warn colour, first person, a retry, the machine detail in mono — never a red
 * paragraph with no way forward (forgejo#191, measured on the rail list under a
 * simulated 503). Retrying re-runs the page's own load; once it succeeds the
 * page draws its rows again and this disappears.
 */
export default function ListLoadFailed({
  title,
  onRetry,
  log,
}: {
  title: string;
  onRetry: () => void;
  log: string | null;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <div
      role="alert"
      className="overflow-hidden rounded-lg"
      style={{ border: "1px solid var(--color-border)" }}
    >
      <EmptyState
        kind="degraded"
        title={title}
        description={t("common:list.loadFailedHint")}
        action={
          <Button variant="secondary" onClick={onRetry}>
            {t("common:buttons.retry")}
          </Button>
        }
        {...(log ? { log } : {})}
      />
    </div>
  );
}

/** The machine detail for a failed list read: an HTTP status, or the transport's code. */
export function loadFailureLog(err: unknown): string | null {
  const e = err as { response?: { status?: number }; code?: string } | null;
  if (e?.response?.status) return `HTTP ${e.response.status}`;
  if (typeof e?.code === "string" && e.code) return e.code;
  return null;
}
