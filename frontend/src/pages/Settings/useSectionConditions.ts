import {
  travTrackSettingsVisible,
  useTravTrackCapabilities,
} from "../../hooks/useTravTrackVisible";
import type { SectionCondition } from "./surface";

/**
 * The server-decided section conditions (`SectionDef.when`), for the settings
 * page and its search alike — so a section the page does not draw is not
 * offered as a search hit either.
 */
export function useSectionConditions(): Partial<Record<SectionCondition, boolean>> {
  const caps = useTravTrackCapabilities();
  return { travTrackHeld: travTrackSettingsVisible(caps) };
}
