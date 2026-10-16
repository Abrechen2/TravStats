import { useMemo, useState } from "react";
import { Button, Dialog, ListRow, SectionLabel, Table, TableRow, type TableColumn } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type {
  LeaderboardScope,
  PeopleResponse,
  Person,
  PersonView,
} from "../../lib/comparison/types";
import ConsentDialog from "./ConsentDialog";

type Question =
  | { kind: "accept"; consentId: string; person: Person }
  | { kind: "change"; consentId: string; person: Person; scope: LeaderboardScope | null };

const ROW_GAP = { gap: "var(--ts-space-xs)" };

/**
 * Requests to answer and the people the reader compares with. A request that
 * has not been accepted shares nothing in either direction, so it is only ever
 * shown as "waiting" — never with a scope or a number.
 */
export default function PeopleSection({
  people,
  onChanged,
}: {
  people: PeopleResponse;
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [question, setQuestion] = useState<Question | null>(null);
  const [ending, setEnding] = useState<Person | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const columns = useMemo<TableColumn[]>(
    () => [
      { key: "name", label: tr("people.name"), min: 140, grow: 2, priority: 1, onNarrow: "title" },
      {
        key: "server",
        label: tr("people.server"),
        min: 120,
        grow: 1,
        priority: 3,
        onNarrow: "subtitle",
      },
      { key: "sees", label: tr("people.sees"), min: 140, grow: 2, priority: 2, onNarrow: "hide" },
      { key: "shares", label: tr("people.shares"), min: 120, priority: 2, onNarrow: "hide" },
      { key: "actions", label: "", min: 200, priority: 1, align: "end", onNarrow: "trailing" },
    ],
    [t]
  );

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setFailed(null);
    try {
      await fn();
      onChanged();
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };

  const sees = (p: PersonView): string => {
    if (p.mine?.status === "pending") return tr("people.waiting");
    if (p.mine?.status === "accepted" && p.mine.scope) {
      return p.mine.scope.groups.map((g) => tr(`group.${g}`)).join(", ");
    }
    return tr("people.notSharing");
  };
  const shares = (p: PersonView): string => {
    if (p.theirs?.status === "accepted") return tr("people.sharing");
    if (p.theirs?.status === "pending") return tr("people.waiting");
    // A person on another server has no consent row of theirs to read.
    return p.person.kind === "remote" ? "—" : tr("people.notSharing");
  };
  const actions = (p: PersonView): JSX.Element => {
    const mine = p.mine;
    return (
      <span className="flex" style={ROW_GAP}>
        {mine?.status === "accepted" && (
          <Button
            variant="secondary"
            onClick={() =>
              setQuestion({
                kind: "change",
                consentId: mine.consentId,
                person: p.person,
                scope: mine.scope,
              })
            }
          >
            {tr("people.change")}
          </Button>
        )}
        {/* Ending is local bookkeeping: it works while the other server is down. */}
        <Button variant="danger" onClick={() => setEnding(p.person)}>
          {tr("people.end")}
        </Button>
      </span>
    );
  };

  return (
    <section
      className="flex flex-col"
      style={{ gap: "var(--ts-space-lg)", marginTop: "var(--ts-space-xxl)" }}
    >
      {people.requests.length > 0 && (
        <div>
          <SectionLabel>{tr("requests.title")}</SectionLabel>
          {people.requests.map((r) => (
            <div key={r.consentId}>
              <ListRow
                title={tr("requests.asks", { name: r.person.displayName })}
                subtitle={r.person.origin ?? undefined}
                trailing={
                  <span className="flex" style={ROW_GAP}>
                    <Button
                      onClick={() =>
                        setQuestion({ kind: "accept", consentId: r.consentId, person: r.person })
                      }
                    >
                      {tr("requests.accept")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void act(() => comparisonApi.decline(r.consentId))}
                    >
                      {tr("requests.decline")}
                    </Button>
                  </span>
                }
              />
              <p className="t-caption">
                {tr("requests.pendingNote", { name: r.person.displayName })}
              </p>
            </div>
          ))}
        </div>
      )}
      {people.people.length > 0 && (
        <div>
          <SectionLabel>{tr("people.title")}</SectionLabel>
          <Table columns={columns} label={tr("people.title")}>
            {people.people.map((p) => (
              <TableRow
                key={p.person.key}
                columns={columns}
                cells={[
                  p.person.displayName,
                  p.person.origin ?? tr("people.thisServer"),
                  sees(p),
                  shares(p),
                  actions(p),
                ]}
              />
            ))}
          </Table>
        </div>
      )}
      {failed && <p role="alert">{failed}</p>}
      {question && (
        <ConsentDialog
          open
          person={question.person}
          initialScope={question.kind === "change" ? question.scope : null}
          onClose={() => setQuestion(null)}
          onConfirm={async (scope) => {
            if (question.kind === "accept") await comparisonApi.accept(question.consentId, scope);
            else await comparisonApi.updateScope(question.consentId, scope);
            setQuestion(null);
            onChanged();
          }}
        />
      )}
      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={tr("people.endTitle", { name: ending?.displayName ?? "" })}
        dismissLabel={tr("common:buttons.cancel")}
        action={
          <Button
            variant="danger"
            onClick={() => {
              const person = ending;
              setEnding(null);
              if (person) void act(() => comparisonApi.end(person.key));
            }}
          >
            {tr("people.endConfirm")}
          </Button>
        }
      >
        <p>{tr("people.endBody")}</p>
      </Dialog>
    </section>
  );
}
