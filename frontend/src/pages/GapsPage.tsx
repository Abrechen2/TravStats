import type { JSX } from "react";
import GapCalendar from "../components/gap/GapCalendar";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import { useTranslation } from "../hooks/useTranslation";
import { useTravTrackState } from "../hooks/useTravTrackVisible";

/**
 * `/gaps` — the gap calendar in the logbook's own place (spec 2026-11-22-gap-calendar).
 * It works without TravTrack: then only the logbook's entries explain a day, and the
 * page says the recorded, privacy-zone and implausible states do not occur.
 */
export default function GapsPage(): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const { access } = useTravTrackState();
  // Not drawn while the answer is pending: the legend would flash states TravTrack may not offer.
  if (access === "pending") return null;
  return (
    <AppShell>
      <PageHeader title={t("track:gaps.pageTitle")} />
      <GapCalendar withTrack={access === "visible"} />
    </AppShell>
  );
}
