import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SettingItem } from "../ui/settings";
import { SettingRows } from "../ui/SettingRow";
import { RatingCategoriesManager } from "../lodging/RatingCategoriesManager";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useRowCopy } from "./rowCopy";

/**
 * "Unterkünfte" (settings v3): the account's rating categories, which until now
 * could only be reached from inside a stay's editor. The row mounts the manager
 * that already lives there (switch the built-in ones, add, rename and delete
 * its own); nothing it does rewrites a stay. The page exists only while stays
 * are on — the area's page table carries the domain.
 */
export default function LodgingRatingsSection(): JSX.Element {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const copy = useRowCopy("lodging")("ratingcats");
  const [managing, setManaging] = useState(false);

  return (
    <SectionCard>
      <SectionTitle title={t("settings:lodgingRatings.title")} />
      <SettingRows>
        <SettingItem title={copy.title} sub={copy.sub} help={copy.help}>
          <RatingCategoriesManager open={managing} onOpenChange={setManaging} />
        </SettingItem>
      </SettingRows>
    </SectionCard>
  );
}
