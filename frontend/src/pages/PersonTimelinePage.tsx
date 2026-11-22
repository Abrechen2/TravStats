import { useCallback, useEffect, useState, type JSX } from "react";
import { Link, useParams } from "react-router-dom";

import {
  DocumentsList,
  FactsList,
  SummaryCards,
  TimelineList,
} from "../components/people/PersonSections";
import ListLoadFailed, { loadFailureLog } from "../components/table/ListLoadFailed";
import { AppShell, EmptyState, PageHeader } from "../components/ui";
import { useTranslation } from "../hooks/useTranslation";
import { companionsApi, type PersonTimeline } from "../lib/api/companions";
import { logger } from "../lib/logger";

/**
 * One companion's page (spec 2026-11-22-person-timeline.md): first and last
 * day together, the shared trips/flights/nights/countries by the statistics'
 * own rules, the shared entries oldest first (planned ones marked), the
 * documents assigned to the person and their own seat / loyalty facts. The
 * server decides every figure; a person that is not yours reads as not found.
 */
export default function PersonTimelinePage(): JSX.Element {
  const { t } = useTranslation(["companions"]);
  const { id = "" } = useParams<{ id: string }>();
  const [data, setData] = useState<PersonTimeline | null>(null);
  const [failure, setFailure] = useState<string | null | undefined>(undefined);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setFailure(undefined);
    setNotFound(false);
    try {
      setData(await companionsApi.timeline(id));
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) setNotFound(true);
      else {
        logger.error("PersonTimelinePage: load failed", err);
        setFailure(loadFailureLog(err));
      }
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  return (
    <AppShell>
      <PageHeader
        title={data?.companion.name ?? t("companions:person.title")}
        meta={
          data?.companion.linkedUser
            ? t("companions:manage.linkedTo", { username: data.companion.linkedUser.username })
            : undefined
        }
        actions={
          <Link to="/settings/freunde" className="t-caption underline">
            {t("companions:person.back")}
          </Link>
        }
      />
      {notFound && (
        <EmptyState
          title={t("companions:person.notFound.title")}
          description={t("companions:person.notFound.description")}
        />
      )}
      {failure !== undefined && (
        <ListLoadFailed
          title={t("companions:person.loadFailed")}
          onRetry={() => void load()}
          log={failure}
        />
      )}
      {!data && !notFound && failure === undefined && (
        <p className="t-caption py-10 text-center" role="status">
          {t("companions:person.loading")}
        </p>
      )}
      {data && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          <SummaryCards summary={data.summary} />
          <TimelineList rows={data.timeline} />
          <div className="grid gap-(--ts-space-xl) lg:grid-cols-2">
            <DocumentsList docs={data.documents} />
            <FactsList facts={data.facts} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
