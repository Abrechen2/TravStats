import type { JSX } from "react";
import { Button, Chip, Field, SectionLabel, Select } from "../ui";
import { Icon } from "../ui/Icon";
import IconButton from "../ui/IconButton";
import { useTranslation } from "../../hooks/useTranslation";
import type { BoardView, PersonView } from "../../lib/comparison/types";

export const MAX_PICKED = 3;

interface Props {
  people: readonly PersonView[];
  boards: readonly BoardView[];
  board: string;
  onBoard: (id: string) => void;
  picked: readonly string[];
  onToggle: (key: string) => void;
  onAdd: () => void;
  onDetail: (person: PersonView) => void;
  /** Shown under the chips: the reason a pick was refused. */
  notice: string | null;
}

/**
 * "Freund wählen": one chip per friend (local and remote alike), up to three picked at once, a
 * settings button per friend, and "Freund hinzufügen". A friend whose answer is still open is
 * listed but cannot be picked — nothing flows yet, so there is nothing to compare.
 */
export default function FriendPicker({
  people,
  boards,
  board,
  onBoard,
  picked,
  onToggle,
  onAdd,
  onDetail,
  notice,
}: Props): JSX.Element {
  const { t } = useTranslation(["comparison"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const members = board ? new Set(boards.find((b) => b.id === board)?.members ?? []) : null;
  const visible = people.filter(
    (p) =>
      (p.mine?.status === "accepted" || p.mine?.status === "pending") &&
      (!members || members.has(p.person.key))
  );
  return (
    <section style={{ marginBottom: "var(--ts-space-xl)" }}>
      <SectionLabel>{tr("friends.pick")}</SectionLabel>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        {visible.map((p) => {
          const waiting = p.mine?.status === "pending";
          return (
            <span key={p.person.key} className="inline-flex items-center" style={{ gap: 4 }}>
              {waiting ? (
                <span className="t-caption">
                  {p.person.displayName} · {tr("friends.waiting")}
                </span>
              ) : (
                <Chip
                  active={picked.includes(p.person.key)}
                  onClick={() => onToggle(p.person.key)}
                  meta={p.person.origin ?? undefined}
                >
                  {p.person.displayName}
                </Chip>
              )}
              <IconButton
                label={tr("friends.details", { name: p.person.displayName })}
                onClick={() => onDetail(p)}
              >
                <Icon name="settings" size={16} />
              </IconButton>
            </span>
          );
        })}
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
