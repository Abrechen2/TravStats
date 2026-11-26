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
 * questions about the user's records.
 *
 * The route stays `/pending-updates`, and every `?tab=` an old link carries
 * still lands: a kind (`review`, `trips`, `updates`, `photos`, `dawarich`)
 * opens the inbox filtered to it, `sharing` opens the sharing tab.
 */

import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Tabs } from "../components/ui/Tabs";

type PageTab = "inbox" | "sharing";

export default function PendingUpdatesPage(): JSX.Element {
  const { t } = useTranslation(["dataQuality", "sharing"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const photoJourneysVisible = usePhotoJourneysVisible();
  const tab: PageTab = searchParams.get("tab") === "sharing" ? "sharing" : "inbox";

  // Both labels carry a count only once it is measured; `null` is "not yet",
  // never a zero. The sharing tab stays mounted so its count is measured too.
  const [inboxCount, setInboxCount] = useState<InboxCount | null>(null);
  const reportInbox = useCallback((count: InboxCount | null) => setInboxCount(count), []);
  const [sharingOpen, setSharingOpen] = useState<number | null>(null);
  const reportSharing = useCallback((n: number) => setSharingOpen(n), []);

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
  ];

  return (
    <AppShell>
      <div className="w-full">
        <PageHeader
          title={t("dataQuality:inbox.title")}
          meta={t("dataQuality:inbox.description")}
        />

        <div className="mb-6">
          <Tabs
            label={t("dataQuality:inbox.tabsLabel")}
            value={tab}
            onChange={(key) =>
              setSearchParams(key === "inbox" ? {} : { tab: key }, { replace: true })
            }
            tabs={tabs.map((item) => ({
              value: item.key,
              label: item.label,
              count: item.count,
            }))}
          />
        </div>

        {/* Lockouts and uploads with retention deadlines precede record questions. */}
        <div hidden={tab !== "inbox"}>
          <PasswordResetRequestsSection />
          <MailIntakeSection />
          <MailboxScanSection />
          <UnfiledDocumentsSection />
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
      </div>
    </AppShell>
  );
}
