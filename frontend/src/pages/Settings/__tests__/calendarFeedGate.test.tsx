import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The calendar subscription card (forgejo#310) sits in the "Reisen" section
 * behind its own beta key, `calendarFeed`: absent while the instance's beta
 * switch is off, there when it is on. The sibling cards are stubbed — this
 * holds the gate, not their contents.
 */

let betaOn = false;
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: betaOn,
    isFeatureVisible: (key: string) => betaOn && key === "calendarFeed",
  }),
}));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));
vi.mock("../../../components/Settings/TripsSection", () => ({ default: () => <p>trips</p> }));
vi.mock("../../../components/Settings/SharingSection", () => ({ default: () => <p>sharing</p> }));
vi.mock("../../../components/Settings/ShareLinksSection", () => ({
  default: () => <p>share-links</p>,
}));
vi.mock("../../../components/Settings/CalendarFeedSection", () => ({
  default: () => <p>calendar-feed</p>,
}));

import SettingsSectionSwitch from "../SettingsSectionSwitch";

type Page = Parameters<typeof SettingsSectionSwitch>[0]["page"];
const page = { user: { username: "owner", isAdmin: false } } as unknown as Page;

describe("calendar feed card gate", () => {
  beforeEach(() => {
    betaOn = false;
  });

  it("is absent from the trips section while the beta switch is off", () => {
    render(<SettingsSectionSwitch section="trips" page={page} />);
    expect(screen.getByText("share-links")).toBeTruthy();
    expect(screen.queryByText("calendar-feed")).toBeNull();
  });

  it("is in the trips section when the beta switch is on", () => {
    betaOn = true;
    render(<SettingsSectionSwitch section="trips" page={page} />);
    expect(screen.getByText("calendar-feed")).toBeTruthy();
  });
});
