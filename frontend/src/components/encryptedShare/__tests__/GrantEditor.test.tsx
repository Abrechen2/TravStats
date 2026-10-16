import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import GrantEditor from "../GrantEditor";
import { encryptedSharePost, type Link } from "../../../lib/api/encryptedShare";
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/encryptedShare", async (original) => ({
  ...(await original<typeof import("../../../lib/api/encryptedShare")>()),
  encryptedSharePost: vi.fn(),
}));
const link: Link = {
  id: "a",
  channel: "b",
  origin: "local",
  label: "Friend",
  confirmed: true,
  remoteConfirmed: true,
  code: "123456",
  grants: [],
};
describe("explicit comparison consent", () => {
  it("starts with every category off, requires preview AND consent, and invalidates approval on edits", async () => {
    vi.mocked(encryptedSharePost).mockResolvedValue({ metrics: { flights: 2 }, trips: [] });
    render(
      <GrantEditor
        link={link}
        domains={["flight"]}
        trips={[]}
        onSaved={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByLabelText("category.statistics")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "saveGrant" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("category.statistics"));
    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    await screen.findByLabelText("consent");
    expect(screen.getByRole("button", { name: "saveGrant" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("consent"));
    expect(screen.getByRole("button", { name: "saveGrant" })).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText("category.costs"));
    await waitFor(() => expect(screen.getByRole("button", { name: "saveGrant" })).toBeDisabled());
    expect(vi.mocked(encryptedSharePost)).toHaveBeenCalledTimes(1);
  });
});

describe("republishing an all-existing-trips grant", () => {
  it("keeps the grant on all existing trips instead of freezing the trip list", async () => {
    // The stored scope carries the resolved trip ids; copying them back into the editor turned
    // "all existing trips (and trip-less records)" into a fixed list that dropped trip-less rows.
    vi.mocked(encryptedSharePost).mockReset();
    vi.mocked(encryptedSharePost).mockResolvedValue({ metrics: { flights: 2 }, trips: [] });
    const stored = {
      statistics: true,
      details: false,
      costs: false,
      personal: false,
      photos: false,
      documents: false,
      domains: ["flight"],
      tripIds: ["t1", "t2"],
      futureTrips: false,
      year: null,
      precision: "exact" as const,
      expiresAt: null,
      allExisting: true,
      acceptedAt: "2026-01-01T00:00:00.000Z",
    };
    render(
      <GrantEditor
        link={{ ...link, grants: [{ audience: "", active: true, revision: 1, scope: stored }] }}
        domains={["flight"]}
        trips={[
          { id: "t1", name: "First" },
          { id: "t2", name: "Second" },
        ]}
        onSaved={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByLabelText("First")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    fireEvent.click(await screen.findByLabelText("consent"));
    fireEvent.click(screen.getByRole("button", { name: "saveGrant" }));
    await waitFor(() => expect(vi.mocked(encryptedSharePost)).toHaveBeenCalledTimes(2));
    const [, saved] = vi.mocked(encryptedSharePost).mock.calls[1] as [string, { scope: object }];
    expect(saved.scope).toMatchObject({ tripIds: [], futureTrips: false });
  });
});
