import { useEffect, useState } from "react";
import { comparisonGet, type Link, type Circle } from "../../lib/api/comparison";
import { sharingStatus, type PublicationStatus } from "../../lib/comparison/sharingStatus";
import { useTranslation } from "../../hooks/useTranslation";
export default function SharingOverview({ links }: { links: Link[] }) {
  const { t, i18n } = useTranslation("comparison");
  const [publications, setPublications] = useState<PublicationStatus[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      comparisonGet<PublicationStatus[]>("/sealed/publications"),
      comparisonGet<Circle[]>("/circles"),
    ])
      .then(([p, c]) => {
        if (active) {
          setPublications(p);
          setCircles(c);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [links]);
  const date = (value?: string) =>
    value
      ? new Date(value).toLocaleString(i18n.language, { timeZone: "UTC", timeZoneName: "short" })
      : "—";
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">{t("e2e.sharingOverview")}</h2>
      <p>{t("e2e.sharingHelp")}</p>
      <p>{t("e2e.revokeLimit")}</p>
      {error && <p role="alert">{t("e2e.error")}</p>}
      {!loaded && !error && <p>{t("loading")}</p>}
      {loaded &&
        links.flatMap((link) =>
          link.grants.map((grant) => {
            const { state, latest } = sharingStatus(link, grant, publications);
            const circle = circles.find((c) => `${c.id}:${c.version}` === grant.audience);
            const status = grant.audience && !circle ? "audienceChanged" : state;
            return (
              <article
                key={`${link.id}:${grant.audience}`}
                className="rounded-xl border border-[var(--ts-border)] p-4 space-y-2"
              >
                <h3 className="font-bold">
                  {grant.audience ? (circle?.name ?? t("circles")) : link.label}
                </h3>
                {circle && (
                  <p>{[t("hostPerson"), ...circle.members.map((m) => m.label)].join(" · ")}</p>
                )}
                <p>{t(`e2e.shareState.${status}`)}</p>
                <p>
                  {["statistics", "details", "costs", "personal", "photos", "documents"]
                    .filter((key) => grant.scope[key as keyof typeof grant.scope] === true)
                    .map((key) => t(`category.${key}`))
                    .join(" · ")}
                </p>
                <p>
                  {t("domains")}:{" "}
                  {grant.scope.domains.map((d) => t(`common:domain.${d}`)).join(" · ")}
                </p>
                <p>
                  {t("year")}: {grant.scope.year ?? t("lifetime")} ·{" "}
                  {t("e2e.tripSelection", { count: grant.scope.tripIds.length })}
                </p>
                <p>
                  {t("updated")}: {date(latest?.createdAt)} · {t("e2e.packageExpiry")}:{" "}
                  {date(latest?.expiresAt)}
                </p>
              </article>
            );
          })
        )}
      {loaded && !links.some((l) => l.grants.length) && <p>{t("e2e.noShares")}</p>}
    </section>
  );
}
