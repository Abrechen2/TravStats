import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import GrantEditor from "../GrantEditor";
import { comparisonPost, type Link } from "../../../lib/api/comparison";
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonPost: vi.fn(),
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
    vi.mocked(comparisonPost).mockResolvedValue({ metrics: { flights: 2 }, trips: [] });
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
    expect(vi.mocked(comparisonPost)).toHaveBeenCalledTimes(1);
  });
});
