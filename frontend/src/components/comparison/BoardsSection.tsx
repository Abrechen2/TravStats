import { useState } from "react";
import { Button, Chip, Dialog, Field, Input, ListRow, SectionLabel } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type { BoardView, PersonView } from "../../lib/comparison/types";

interface Draft {
  id?: string;
  name: string;
  members: string[];
}

/**
 * Named groups of people whose numbers the reader can see — a private filter,
 * nobody is asked. Only people who have accepted (they share with the reader)
 * and friends on other servers can be members; a pending person shares nothing.
 */
export default function BoardsSection({
  boards,
  people,
  onChanged,
}: {
  boards: BoardView[];
  people: PersonView[];
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<BoardView | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const visible = people.filter(
    (p) => p.person.kind === "remote" || p.theirs?.status === "accepted"
  );
  const visibleKeys = new Set(visible.map((p) => p.person.key));
  // A member who stopped sharing is no longer in `people`; the key is an internal id, never copy.
  const nameOf = (key: string): string =>
    people.find((p) => p.person.key === key)?.person.displayName ?? tr("boards.memberGone");

  const openEditor = (next: Draft): void => {
    setFailed(null);
    setDraft(next);
  };
  const save = async (current: Draft): Promise<void> => {
    setFailed(null);
    setSaving(true);
    try {
      await comparisonApi.saveBoard(
        { name: current.name.trim(), members: current.members },
        current.id
      );
      setDraft(null);
      onChanged();
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (board: BoardView): Promise<void> => {
    setFailed(null);
    setDeleting(null);
    try {
      await comparisonApi.deleteBoard(board.id);
      onChanged();
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };

  return (
    <section style={{ marginTop: "var(--ts-space-2xl)" }}>
      <SectionLabel>{tr("boards.title")}</SectionLabel>
      {boards.length === 0 && (
        <p className="t-caption">{tr(visible.length === 0 ? "boards.noPeople" : "boards.empty")}</p>
      )}
      {boards.map((b) => (
        <ListRow
          key={b.id}
          title={b.name}
          subtitle={b.members.map(nameOf).join(", ")}
          trailing={
            <span className="flex" style={{ gap: "var(--ts-space-xs)" }}>
              <Button
                variant="secondary"
                onClick={() =>
                  openEditor({
                    id: b.id,
                    name: b.name,
                    members: b.members.filter((k) => visibleKeys.has(k)),
                  })
                }
              >
                {tr("people.change")}
              </Button>
              <Button variant="danger" onClick={() => setDeleting(b)}>
                {tr("boards.delete")}
              </Button>
            </span>
          }
        />
      ))}
      <Button
        variant="secondary"
        disabled={visible.length === 0}
        onClick={() => openEditor({ name: "", members: [] })}
      >
        {tr("boards.create")}
      </Button>
      {failed && draft === null && <p role="alert">{failed}</p>}

      <Dialog
        open={draft !== null}
        onClose={() => {
          setDraft(null);
          setFailed(null);
        }}
        title={tr("boards.title")}
        dismissLabel={tr("common:buttons.cancel")}
        busy={saving}
        action={
          <Button
            disabled={!draft?.name.trim() || saving}
            onClick={() => draft && void save(draft)}
          >
            {tr("boards.save")}
          </Button>
        }
      >
        {draft && (
          <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
            <Field label={tr("boards.name")} htmlFor="board-name">
              <Input
                id="board-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <div
              role="group"
              aria-label={tr("boards.members")}
              className="flex flex-wrap"
              style={{ gap: "var(--ts-space-xs)" }}
            >
              {visible.map((p) => (
                <Chip
                  key={p.person.key}
                  active={draft.members.includes(p.person.key)}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      members: draft.members.includes(p.person.key)
                        ? draft.members.filter((k) => k !== p.person.key)
                        : [...draft.members, p.person.key],
                    })
                  }
                >
                  {p.person.displayName}
                </Chip>
              ))}
            </div>
            {failed && <p role="alert">{failed}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={tr("boards.deleteTitle", { name: deleting?.name ?? "" })}
        dismissLabel={tr("common:buttons.cancel")}
        action={
          <Button variant="danger" onClick={() => deleting && void remove(deleting)}>
            {tr("boards.deleteConfirm")}
          </Button>
        }
      >
        <p>{tr("boards.deleteBody")}</p>
      </Dialog>
    </section>
  );
}
