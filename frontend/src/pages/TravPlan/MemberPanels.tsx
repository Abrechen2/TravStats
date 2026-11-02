import { useEffect, useState } from "react";
import { Button, Card, Select, TextArea } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import type { PlanCollab, PlanMember, PlanView } from "../../lib/api/travplan";
import { PlanActions, PlanCardHead, PlanNotice } from "./planLayout";

/** What the other members changed since the caller last looked, worded from the summary code. */
export function MemberNotices({
  collab,
  onRead,
}: {
  collab: PlanCollab | null;
  onRead: () => void;
}) {
  const { t } = useTranslation("travplan");
  if (!collab?.notices.length) return null;
  return (
    <PlanNotice>
      <ul>
        {collab.notices.map((n) => (
          <li key={n.id}>
            {t("members.notice", {
              name: n.actorName,
              what: t("members.summary." + n.summary.split(":")[0], {
                defaultValue: t("members.summary.other"),
              }),
            })}
          </li>
        ))}
      </ul>
      <Button onClick={onRead}>{t("members.noticeRead")}</Button>
    </PlanNotice>
  );
}

/** The caller's private note on the plan: stored per member, read by nobody else (spec §6.2). */
export function MemberNoteCard({
  plan,
  busy,
  save,
}: {
  plan: PlanView;
  busy: boolean;
  save: (text: string) => Promise<boolean>;
}) {
  const { t } = useTranslation("travplan"),
    mine = plan.state.memberNotes.find((n) => n.memberId === plan.self?.memberId)?.text ?? "",
    [text, setText] = useState(mine);
  useEffect(() => setText(mine), [mine]);
  if (!plan.self) return null;
  return (
    <Card>
      <PlanCardHead title={t("members.noteTitle")} />
      <p className="t-caption">{t("members.noteHint")}</p>
      <TextArea
        aria-label={t("members.noteTitle")}
        rows={4}
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <PlanActions>
        <Button disabled={busy || text === mine} onClick={() => void save(text)}>
          {t("save")}
        </Button>
      </PlanActions>
    </Card>
  );
}

/** Who brings a shared packing item: a select over the active members. */
export function BringsSelect({
  value,
  members,
  disabled,
  onChange,
}: {
  value: string | null;
  members: PlanMember[];
  disabled: boolean;
  onChange: (memberId: string | null) => void;
}) {
  const { t } = useTranslation("travplan"),
    active = members.filter((m) => m.status === "active");
  if (active.length < 2) return null;
  return (
    <Select
      aria-label={t("members.brings")}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{t("members.bringsNobody")}</option>
      {active.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </Select>
  );
}
