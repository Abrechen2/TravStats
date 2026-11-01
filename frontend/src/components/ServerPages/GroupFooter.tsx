import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import { GroupStateMark, type GroupSave } from "../ui/settings";

/**
 * The foot of a group with an explicit save (B6, group half): the button, the
 * way back, and the state. A failed save keeps the draft; the state says why.
 */
export default function GroupFooter({
  group,
  saveLabel,
  disabled = false,
}: {
  group: Pick<GroupSave<Record<string, unknown>>, "state" | "reason" | "save" | "discard">;
  saveLabel?: string;
  /** The draft cannot be saved yet (a required value is missing). */
  disabled?: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
      <Button
        variant="primary"
        disabled={disabled || group.state === "unchanged" || group.state === "saving"}
        onClick={() => void group.save()}
      >
        {saveLabel ?? t("settings:blocks.save.saveGroup")}
      </Button>
      {group.state === "dirty" || group.state === "failed" ? (
        <Button variant="secondary" onClick={group.discard}>
          {t("settings:blocks.save.discardGroup")}
        </Button>
      ) : null}
      <GroupStateMark state={group.state} reason={group.reason} />
    </div>
  );
}
