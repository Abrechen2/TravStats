import { useState } from "react";
import type { JSX } from "react";
import { Button, ListRow, SectionLabel } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type { OwnAdmission, RequestView } from "../../lib/comparison/types";
import ConsentDialog from "../comparison/ConsentDialog";

/** Outgoing requests that are finished well need no line here. */
const SHOWN = new Set<OwnAdmission["status"]>(["pending", "sent", "declined", "failed", "expired"]);
const GAP = { gap: "var(--ts-space-xs)" };

interface Props {
  requests: readonly RequestView[];
  admissions: readonly OwnAdmission[];
  onChanged: () => void;
}

/**
 * "Anfragen": a friend's request to see your totals (answer with the scope dialog), and the
 * reader's own invitations that wait on an admin. Renders nothing when there is nothing to answer.
 */
export default function RequestsSection({
  requests,
  admissions,
  onChanged,
}: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [accepting, setAccepting] = useState<RequestView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const shown = admissions.filter((a) => SHOWN.has(a.status));
  if (requests.length === 0 && shown.length === 0) return null;

  const decline = async (request: RequestView): Promise<void> => {
    setFailed(null);
    try {
      await comparisonApi.decline(request.consentId);
      onChanged();
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };
  /** A reason is shown only when it is a code this build has copy for — never raw server prose. */
  const reasonOf = (a: OwnAdmission): string | null =>
    a.failureReason && i18n.exists(`comparison:error.${a.failureReason}`)
      ? tr(`error.${a.failureReason}`)
      : null;

  return (
    <section
      className="flex flex-col"
      aria-label={tr("requests.title")}
      style={{ gap: "var(--ts-space-md)", marginBottom: "var(--ts-space-xl)" }}
    >
      <SectionLabel>{tr("requests.title")}</SectionLabel>
      {requests.map((r) => (
        <div key={r.consentId}>
          <ListRow
            title={tr("requests.asks", { name: r.person.displayName })}
            subtitle={r.person.origin ?? undefined}
            trailing={
              <span className="flex" style={GAP}>
                <Button onClick={() => setAccepting(r)}>{tr("requests.accept")}</Button>
                <Button variant="secondary" onClick={() => void decline(r)}>
                  {tr("requests.decline")}
                </Button>
              </span>
            }
          />
          <p className="t-caption">{tr("requests.pendingNote", { name: r.person.displayName })}</p>
        </div>
      ))}
      {shown.map((a) => (
        <ListRow
          key={a.id}
          title={a.origin}
          subtitle={[tr(`friends.admission.${a.status}`, { origin: a.origin }), reasonOf(a)]
            .filter(Boolean)
            .join(" – ")}
        />
      ))}
      {failed && <p role="alert">{failed}</p>}
      {accepting && (
        <ConsentDialog
          open
          mode="accept"
          person={accepting.person}
          onClose={() => setAccepting(null)}
          onConfirm={async (scope) => {
            await comparisonApi.accept(accepting.consentId, scope);
            setAccepting(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
