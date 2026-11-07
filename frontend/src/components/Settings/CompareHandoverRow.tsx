import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { JumpControl, SettingItem, useGuardedNavigate } from "../ui/settings";
import { SettingRows } from "../ui/SettingRow";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useRowCopy } from "./rowCopy";

const TARGETS = { rangliste: "/freunde", verschl: "/encrypted-share" } as const;

/**
 * "Vergleichen & übergeben" (design §4 A12): the leaderboard's consent and the
 * encrypted hand-over live on their own pages — these rows lead there. They
 * stay two different features (CLAUDE.md, comparison): the leaderboard never
 * imports the encrypted share, so each is its own mount and its own row. Locked
 * in the demo account, where neither is offered.
 */
export default function CompareHandoverRow({
  row,
  withTitle,
}: {
  row: keyof typeof TARGETS;
  /** The first of the two draws the section's heading. */
  withTitle: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const copy = useRowCopy("sharing")(row);
  const go = useGuardedNavigate();
  const isDemo = useIsDemoAccount();
  return (
    <SectionCard>
      {withTitle ? <SectionTitle title={t("settingsRows:sharing.sections.compare")} /> : null}
      <SettingRows>
        <SettingItem
          title={copy.title}
          sub={copy.sub}
          locked={isDemo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
          control={<JumpControl label={copy.btn ?? ""} onJump={() => go(TARGETS[row])} />}
        />
      </SettingRows>
    </SectionCard>
  );
}
