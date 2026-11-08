import type { JSX } from "react";
import { Button, Chip, Field, SectionLabel, Select } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import type { BoardView } from "../../lib/comparison/types";
import type { Friend } from "../../lib/friends/types";

export const MAX_PICKED = 3;

interface Props {
  friends: readonly Friend[];
  boards: readonly BoardView[];
  board: string;
  onBoard: (id: string) => void;
  picked: readonly string[];
  onToggle: (key: string) => void;
  onAdd: () => void;
  /** Shown under the chips: the reason a pick was refused. */
  notice: string | null;
}

/**
 * "Freund wählen": one chip per friend (local and remote alike), up to three picked at once, and
 * "Freund hinzufügen" (the gear lives in each friend's own head). A friend whose answer is still open is
 * listed but cannot be picked — nothing flows yet, so there is nothing to compare.
 */
export default function FriendPicker({
  friends,
  boards,
  board,
  onBoard,
  picked,
  onToggle,
  onAdd,
  notice,
}: Props): JSX.Element {
  const { t } = useTranslation(["comparison"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const members = board ? new Set(boards.find((b) => b.id === board)?.members ?? []) : null;
  const visible = friends.filter(
    (f) => (f.state === "active" || f.state === "pending_out") && (!members || members.has(f.key))
  );
  return (
    <section style={{ marginBottom: "var(--ts-space-xl)" }}>
      <SectionLabel>{tr("friends.pick")}</SectionLabel>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        {visible.map((f) =>
          f.state === "pending_out" ? (
            <span key={f.key} className="t-caption">
              {f.displayName} · {tr("friends.waiting")}
            </span>
          ) : (
            <Chip
              key={f.key}
              active={picked.includes(f.key)}
              onClick={() => onToggle(f.key)}
              meta={f.origin ?? undefined}
            >
              {f.displayName}
            </Chip>
          )
        )}
        <Button variant="secondary" onClick={onAdd}>
          {tr("friends.add")}
        </Button>
        {boards.length > 0 && (
          <Field label={tr("board.label")} htmlFor="friends-board">
            <Select id="friends-board" value={board} onChange={(e) => onBoard(e.target.value)}>
              <option value="">{tr("board.all")}</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <p className="t-caption" role={notice ? "status" : undefined}>
        {notice ?? tr("friends.pickHint")}
      </p>
    </section>
  );
}
