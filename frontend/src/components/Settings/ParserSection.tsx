import { SectionCard, SectionTitle } from "./SettingsShared";
import ParserConfiguration from "./ParserConfiguration";
import TemplateStatusView from "../TemplateStatusView";
import { useTranslation } from "../../hooks/useTranslation";

export default function ParserSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:parser.title")}
        description={t("settings:parser.description")}
      />
      <ParserConfiguration />
      <TemplateStatusView />
    </SectionCard>
  );
}
