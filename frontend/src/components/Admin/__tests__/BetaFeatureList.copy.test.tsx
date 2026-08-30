import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import BetaFeatureList from "../BetaFeatureList";
import { BETA_FEATURES, BETA_FEATURE_KEYS } from "../../../config/betaFeatures";
import de from "../../../i18n/resources/de/admin.json";
import en from "../../../i18n/resources/en/admin.json";

/**
 * The list beside the beta switch has to be TRUE, not merely present.
 *
 * An admin was asked to flip a switch whose help text warns that the features
 * behind it "can change or disappear", and was never told which ones. The list
 * answers that — but a list about hidden features is exactly the kind that rots
 * silently: nobody notices a missing row, because the whole point is that the
 * thing is not visible.
 *
 * So the rows are DERIVED from the registry every gate reads, and these tests
 * hold the two halves that derivation cannot:
 *
 *   1. Every registry key has German AND English copy. Without this, adding a
 *      gate would render a raw i18n key to an admin — or, worse, fall through
 *      to English on a German page, which is the failure that shipped 25 badges
 *      in the wrong language earlier the same day.
 *   2. Nothing is described that is not actually gated. A leftover entry for a
 *      feature that shipped months ago is a promise the switch no longer keeps.
 */
type AdminCopy = {
  instance: {
    fields: {
      betaFeatures: {
        features: Record<string, { name?: string; what?: string }>;
        reason: Record<string, string>;
        listTitle?: string;
        listNote?: string;
        listEmpty?: string;
      };
    };
  };
};

const deCopy = (de as AdminCopy).instance.fields.betaFeatures;
const enCopy = (en as AdminCopy).instance.fields.betaFeatures;

describe("the beta switch says what it turns on", () => {
  it("describes every gated feature, in both languages", () => {
    const missing = BETA_FEATURE_KEYS.flatMap((key) => [
      ...(deCopy.features[key]?.name ? [] : [`de/${key}.name`]),
      ...(deCopy.features[key]?.what ? [] : [`de/${key}.what`]),
      ...(enCopy.features[key]?.name ? [] : [`en/${key}.name`]),
      ...(enCopy.features[key]?.what ? [] : [`en/${key}.what`]),
    ]);
    expect(missing).toEqual([]);
  });

  it("describes nothing that is no longer gated", () => {
    const gated = new Set<string>(BETA_FEATURE_KEYS);
    const stale = Object.keys(deCopy.features).filter((key) => !gated.has(key));
    expect(stale).toEqual([]);
  });

  it("names every reason a feature can carry", () => {
    // `reason` drives a badge. A new reason value would otherwise render its
    // own key to the admin.
    const reasons = new Set(BETA_FEATURE_KEYS.map((key) => BETA_FEATURES[key].reason));
    for (const reason of reasons) {
      expect(deCopy.reason[reason]).toBeTruthy();
      expect(enCopy.reason[reason]).toBeTruthy();
    }
  });

  it("renders one row per gated feature", () => {
    // Derivation, observed rather than assumed: the count on screen follows the
    // registry, so a feature added there appears here without anyone editing
    // this component.
    render(<BetaFeatureList />);
    for (const key of BETA_FEATURE_KEYS) {
      expect(
        screen.getByText(`admin:instance.fields.betaFeatures.features.${key}.name`)
      ).toBeInTheDocument();
    }
  });

  it("says so plainly when nothing is gated at all", () => {
    // The registry emptying out is the goal, not an error state — every gate
    // is meant to be deleted eventually.
    expect(deCopy.listEmpty).toBeTruthy();
    expect(enCopy.listEmpty).toBeTruthy();
  });
});
