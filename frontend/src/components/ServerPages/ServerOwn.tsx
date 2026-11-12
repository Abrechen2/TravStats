import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import { ErrorLine } from "../ui/settings";
import FieldsGroup from "../Services/FieldsGroup";
import { ServicesProvider, useServices } from "../Services/servicesContext";
import { useDemoLock } from "../Services/useLockFor";
import SubHeading from "./SubHeading";
import { useInternetDependency } from "./useInternetDependency";

/**
 * The groups of the page, in the prototype's order: which catalogue card holds
 * the fields, which of its fields the group shows, and whether the group needs
 * the master switch "Server darf externe Dienste abfragen" (an own Overpass, an
 * own template source or exchange rate source is still a call that switch gates).
 */
const GROUPS: ReadonlyArray<{
  id: string;
  card: string;
  keys: readonly string[];
  gated: boolean;
}> = [
  {
    id: "places",
    card: "geocoder",
    keys: ["ownGeoUrl", "photonUrl", "nominatimUrl"],
    gated: false,
  },
  { id: "routes", card: "selfHostedRouting", keys: ["osrmUrl", "railRoutingUrl"], gated: false },
  { id: "maps", card: "openData", keys: ["marketOverpassUrl"], gated: true },
  { id: "templates", card: "updatesTemplates", keys: ["templateRepoUrl"], gated: true },
  {
    id: "rates",
    card: "fx",
    keys: ["primarySource", "primaryUrl", "fallbackSource", "fallbackUrl"],
    gated: true,
  },
];

function Groups(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const { admin } = useServices();
  const demo = useDemoLock();
  const internet = useInternetDependency();
  if (admin?.loadError && !admin.data) {
    return (
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <ErrorLine>{t("settingsRows:services.ui.serverLoadFailed")}</ErrorLine>
        <Button variant="secondary" onClick={() => void admin.reload()}>
          {t("settingsRows:services.ui.retry")}
        </Button>
      </div>
    );
  }
  if (!admin?.data) return <p className="t-caption">{t("settingsRows:services.ui.loading")}</p>;
  const services = admin.data.categories.flatMap((c) => c.services);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      {GROUPS.map((group) => {
        const service = services.find((s) => s.id === group.card);
        const fields = service?.fields.filter((f) => group.keys.includes(f.key)) ?? [];
        if (!service || fields.length === 0) return null;
        return (
          <section
            key={group.id}
            className="flex flex-col"
            style={{ gap: "var(--ts-space-md)" }}
            data-own-group={group.id}
          >
            <SubHeading id={group.id}>{t(`settingsRows:own.sections.${group.id}`)}</SubHeading>
            <FieldsGroup
              id={`own.${group.id}`}
              label={t(`settingsRows:own.sections.${group.id}`)}
              serviceId={group.card}
              fields={fields}
              secretTemplate="instKey"
              tests={false}
              lock={demo}
              errorText={null}
              dependencyOf={group.gated ? () => internet : undefined}
              write={async (changes) => {
                if (!(await admin.write(group.card, changes))) throw new Error("save refused");
              }}
            />
          </section>
        );
      })}
    </div>
  );
}

/**
 * Server › Eigene Server (expert page, settings v3 S5): the addresses of your
 * own infrastructure in place of the public services — place search, routing,
 * map data, the template source and the exchange rate source. They were fields
 * of the service catalogue's cards; they are the same fields, on a page of their
 * own.
 */
export default function ServerOwn(): JSX.Element {
  return (
    <ServicesProvider isAdmin>
      <Groups />
    </ServicesProvider>
  );
}
