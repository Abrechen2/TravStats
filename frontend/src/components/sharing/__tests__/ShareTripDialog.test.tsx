import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ShareTripDialog from "../ShareTripDialog";
import { sharingApi } from "../../../lib/api/sharing";
import type { ShareBlock, TripPerson } from "../../../types/sharing";
import de from "../../../i18n/resources/de/sharing.json";
import en from "../../../i18n/resources/en/sharing.json";

/**
 * Sharing copies the trip into another account and cannot be taken back
 * (decision 5), so it is a dialog that says what is copied and what stays
 * private, with ONE confirm — never a checkbox (spec 2026-10-16, D9).
 */
vi.mock("../../../lib/api/sharing", () => ({ sharingApi: { shareTrip: vi.fn() } }));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
const api = vi.mocked(sharingApi);

const ben: TripPerson = {
  key: "c:c-ben",
  companionId: "c-ben",
  name: "Ben",
  account: { id: "u-ben", username: "ben", displayName: "Ben" },
  consent: "accepted",
  member: false,
  receivesChanges: null,
  shareBlockedBy: null,
};
const ilse: TripPerson = {
  ...ben,
  key: "c:c-ilse",
  companionId: "c-ilse",
  name: "Ilse",
  account: null,
  consent: "none",
  shareBlockedBy: "notLinked",
};

const BLOCKS: ShareBlock[] = [
  "notLinked",
  "consentMissing",
  "consentPending",
  "groupConsentMissing",
  "alreadyMember",
  "accountInactive",
];

describe("ShareTripDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says what is copied, what stays private and that it is final, then shares on confirm", async () => {
    api.shareTrip.mockResolvedValue({ groupId: "g", tripCreated: true, created: {} as never });
    const onShared = vi.fn();
    render(
      <ShareTripDialog
        open
        onClose={vi.fn()}
        tripId="t1"
        people={[ben, ilse]}
        preselectedKey="c:c-ben"
        onShared={onShared}
      />
    );
    expect(screen.getByText("sharing:shareDialog.copied")).toBeTruthy();
    expect(screen.getByText("sharing:shareDialog.private")).toBeTruthy();
    expect(screen.getByText("sharing:shareDialog.final")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "sharing:shareDialog.confirm" }));
    expect(api.shareTrip).toHaveBeenCalledWith("t1", "c-ben");
    await waitFor(() => expect(onShared).toHaveBeenCalled());
  });

  it("offers only people who can be shared with, and keeps a refusal on the dialog", async () => {
    api.shareTrip.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { code: "SHARE_GROUP_CONSENT_REQUIRED" } },
    });
    render(
      <ShareTripDialog open onClose={vi.fn()} tripId="t1" people={[ben, ilse]} onShared={vi.fn()} />
    );
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Ben (@ben)"]);
    await userEvent.click(screen.getByRole("button", { name: "sharing:shareDialog.confirm" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "sharing:errors.groupConsentRequired"
    );
  });

  it("explains why a blocked person cannot be chosen, for every block including accountInactive", () => {
    const blocked = BLOCKS.map((b): TripPerson => ({
      ...ben,
      key: `c:${b}`,
      companionId: b,
      name: b,
      shareBlockedBy: b,
    }));
    render(
      <ShareTripDialog
        open
        onClose={vi.fn()}
        tripId="t1"
        people={[ben, ...blocked]}
        onShared={vi.fn()}
      />
    );
    for (const b of BLOCKS) {
      expect(screen.getByText(`sharing:shareDialog.blocked.${b}`)).toBeTruthy();
    }
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ben (@ben)"]);
  });

  it("has a German and an English explanation for every block", () => {
    for (const bundle of [de, en]) {
      for (const b of BLOCKS) {
        const text = (bundle.shareDialog.blocked as Record<string, string>)[b];
        expect(text, b).toBeTruthy();
      }
    }
  });

  it("tells a declined and a withdrawn request apart from one never sent", () => {
    const missing = (name: string, consent: TripPerson["consent"]): TripPerson => ({
      ...ben,
      key: `c:${name}`,
      companionId: name,
      name,
      consent,
      shareBlockedBy: "consentMissing",
    });
    render(
      <ShareTripDialog
        open
        onClose={vi.fn()}
        tripId="t1"
        people={[
          ben,
          missing("Nie", "none"),
          missing("Nein", "declined"),
          missing("Weg", "withdrawn"),
        ]}
        onShared={vi.fn()}
      />
    );
    expect(screen.getByText("sharing:shareDialog.blocked.consentMissing")).toBeTruthy();
    expect(screen.getByText("sharing:shareDialog.blocked.consentDeclined")).toBeTruthy();
    expect(screen.getByText("sharing:shareDialog.blocked.consentWithdrawn")).toBeTruthy();
    for (const bundle of [de, en]) {
      const blocked = bundle.shareDialog.blocked as Record<string, string>;
      expect(blocked.consentDeclined).toBeTruthy();
      expect(blocked.consentWithdrawn).toBeTruthy();
    }
  });

  it("offers no confirm when a blocked person is preselected", () => {
    render(
      <ShareTripDialog
        open
        onClose={vi.fn()}
        tripId="t1"
        people={[{ ...ben, shareBlockedBy: "accountInactive" }]}
        preselectedKey="c:c-ben"
        onShared={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "sharing:shareDialog.confirm" })).toBeNull();
    expect(screen.getByText("sharing:shareDialog.blocked.accountInactive")).toBeTruthy();
  });

  it("explains a blocked preselected person and lets the user pick an eligible one instead", async () => {
    api.shareTrip.mockResolvedValue({ groupId: "g", tripCreated: true, created: {} as never });
    render(
      <ShareTripDialog
        open
        onClose={vi.fn()}
        tripId="t1"
        people={[ben, { ...ilse, shareBlockedBy: "consentPending" }]}
        preselectedKey="c:c-ilse"
        onShared={vi.fn()}
      />
    );
    expect(screen.getByText("sharing:shareDialog.blocked.consentPending")).toBeTruthy();
    expect(screen.queryByText("sharing:shareDialog.nobody")).toBeNull();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ben (@ben)"]);
    // Only a chosen, selectable person gets the copy paragraphs and the confirm.
    expect(screen.getByText("sharing:shareDialog.final")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "sharing:shareDialog.confirm" }));
    expect(api.shareTrip).toHaveBeenCalledWith("t1", "c-ben");
  });

  it("starts clean when reopened: no stale refusal from the last opening", async () => {
    api.shareTrip.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { code: "SHARE_GROUP_CONSENT_REQUIRED" } },
    });
    const props = { onClose: vi.fn(), tripId: "t1", people: [ben], onShared: vi.fn() };
    const { rerender } = render(<ShareTripDialog open {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "sharing:shareDialog.confirm" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    rerender(<ShareTripDialog open={false} {...props} />);
    rerender(<ShareTripDialog open {...props} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
