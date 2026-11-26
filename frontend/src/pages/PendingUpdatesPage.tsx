/**
 * Posteingang — the one place the user answers questions about their data.
 *
 * ONE inbox (2026-10-16). Codex's workspace (`components/inbox/workspace`)
 * had been added beside the per-kind tabs it was meant to replace, so every
 * question, flight update, trip proposal and photo suggestion had two cards
 * with two different action sets. The workspace is now the inbox: each kind
 * has one card, the per-kind tabs became its filter, and what only the old
 * tabs could do (resolve a question, apply a flight update with its source
 * and expiry shown, quick-accept a trip, scan the photo library, answer
 * several visits at once, look back at answered items) moved into it.
 *
 * The backends stay apart on purpose (design §3.5): `DataQualityFlag`,
 * `PendingFlightUpdate`, the trip engine's derived proposals and
 * `PhotoJourney` are different things that share a page, not a table.
 *
 * Shared trips keep their own tab: consent requests and notices are not
 * questions about the user's records. Unfiled documents (`?tab=documents`) and
 * the plugins' maintenance proposals and notices (`?tab=plugins`) have their own
 * tabs too (owner 2026-11-26); the overview only links to waiting documents.
 *
 * The route stays `/pending-updates`, and every `?tab=` an old link carries
 * still lands: a kind (`review`, `trips`, `updates`, `photos`, `dawarich`)
 * opens the inbox filtered to it, `sharing` opens the sharing tab.
 */

import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import { useTranslation } from "../hooks/useTranslation";
import PlaceCapturesSection from "../components/inbox/PlaceCapturesSection";
import InboxWorkspace, { type InboxCount } from "../components/inbox/workspace/InboxWorkspace";
import SharingTab from "../components/inbox/SharingTab";
import PasswordResetRequestsSection from "../components/inbox/PasswordResetRequestsSection";
import UnfiledDocumentsSection from "../components/inbox/UnfiledDocumentsSection";
import DocumentLinkSuggestionsSection from "../components/inbox/DocumentLinkSuggestionsSection";
import ProvenanceNoticesSection from "../components/inbox/ProvenanceNoticesSection";
import MailIntakeSection from "../components/inbox/MailIntakeSection";
import MailboxScanSection from "../components/inbox/MailboxScanSection";
import { usePhotoJourneysVisible } from "../components/inbox/usePhotoJourneysVisible";
import PluginsTab from "../components/inbox/plugins/PluginsTab";

type PageTab = "inbox" | "sharing" | "documents" | "plugins";
const PAGE_TABS: readonly PageTab[] = ["inbox", "sharing", "documents", "plugins"];

export default function PendingUpdatesPage(): JSX.Element {
  const { t } = useTranslation(["dataQuality", "sharing"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const photoJourneysVisible = usePhotoJourneysVisible();
  const tab: PageTab = PAGE_TABS.find((k) => k === searchParams.get("tab")) ?? "inbox";

  // Both labels carry a count only once it is measured; `null` is "not yet",
  // never a zero. The sharing tab stays mounted so its count is measured too.
  const [inboxCount, setInboxCount] = useState<InboxCount | null>(null);
  const reportInbox = useCallback((count: InboxCount | null) => setInboxCount(count), []);
  const [sharingOpen, setSharingOpen] = useState<number | null>(null);
  const reportSharing = useCallback((n: number) => setSharingOpen(n), []);
  const [documentsWaiting, setDocumentsWaiting] = useState<number | null>(null);
  const reportDocuments = useCallback((n: number | null) => setDocumentsWaiting(n), []);
  const [pluginsOpen, setPluginsOpen] = useState<number | null>(null);
  const reportPlugins = useCallback((n: number | null) => setPluginsOpen(n), []);

  const tabs: { key: PageTab; label: string; count: string | null }[] = [
    {
      key: "inbox",
      label: t("dataQuality:inbox.workspace.title"),
      count: inboxCount ? `${inboxCount.count}${inboxCount.complete ? "" : "+?"}` : null,
    },
    {
      key: "sharing",
      label: t("sharing:inbox.title"),
      count: sharingOpen === null ? null : String(sharingOpen),
    },
    {
      key: "documents",
      label: t("dataQuality:inbox.tabs.documents"),
      count: documentsWaiting ? String(documentsWaiting) : null,
    },
    {
      key: "plugins",
      label: t("dataQuality:inbox.tabs.plugins"),
      count: pluginsOpen ? String(pluginsOpen) : null,
    },
  ];

  return (
    <AppShell>
      <div className="w-full">
        <PageHeader
          title={t("dataQuality:inbox.title")}
          meta={t("dataQuality:inbox.description")}
        />

        <div
          role="tablist"
          className="mb-6 flex overflow-x-auto scrollbar-none"
          style={{ borderBottom: "1px solid var(--ts-border)" }}
        >
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() =>
                  setSearchParams(item.key === "inbox" ? {} : { tab: item.key }, {
                    replace: true,
                  })
                }
                className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3 text-sm"
                style={{
                  fontWeight: active ? 700 : 500,
                  color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                  boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
                }}
              >
                {item.label}
                {item.count !== null && (
                  <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Lockouts and uploads with retention deadlines precede record questions. */}
        <div hidden={tab !== "inbox"}>
          <PasswordResetRequestsSection />
          <MailIntakeSection />
          <MailboxScanSection />
          {documentsWaiting !== null && documentsWaiting > 0 && (
            <p className="t-caption mb-4" data-testid="inbox-documents-link">
              <Link to="?tab=documents" replace>
                {t("dataQuality:inbox.tabs.documentsLink", { count: documentsWaiting })}
              </Link>
            </p>
          )}
          <DocumentLinkSuggestionsSection />
          <ProvenanceNoticesSection />
          <PlaceCapturesSection />
          <InboxWorkspace
            photosVisible={photoJourneysVisible}
            active={tab === "inbox"}
            onCount={reportInbox}
          />
        </div>
        <div hidden={tab !== "sharing"}>
          <SharingTab onCount={reportSharing} />
        </div>
        {/* Mounted while hidden, like sharing, so the tab label carries its count. */}
        <div hidden={tab !== "documents"}>
          <UnfiledDocumentsSection onCount={reportDocuments} />
        </div>
        <div hidden={tab !== "plugins"}>
          <PluginsTab onCount={reportPlugins} />
        </div>
      </div>
    </AppShell>
  );
}
