import { useParams, useLocation } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import { PlanList, PlanAdmin } from "./TravPlan/PlanList";
import PlanContent, { PLAN_SECTIONS } from "./TravPlan/PlanContent";

/**
 * TravPlan, the planning mode. It lives inside the app's own shell and header:
 * the planning sections are the page's own strip, not a replacement for the
 * primary navigation, and the page reads the app's tokens rather than a theme
 * of its own.
 */
export default function TravPlanPage() {
  const { tripId, section = "overview" } = useParams(),
    location = useLocation();
  return (
    <AppShell width="list">
      {location.pathname === "/plan/admin" ? (
        <PlanAdmin />
      ) : tripId ? (
        <PlanContent
          key={tripId}
          tripId={tripId}
          section={PLAN_SECTIONS.includes(section) ? section : "overview"}
        />
      ) : (
        <PlanList />
      )}
    </AppShell>
  );
}
