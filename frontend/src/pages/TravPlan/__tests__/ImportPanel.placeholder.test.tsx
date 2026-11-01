import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportPanel from "../ImportPanel";
import type { PlanBooking } from "../../../lib/api/travplan";
import { planFixture } from "./planFixture";

const mocks = vi.hoisted(() => ({
  matches: vi.fn(),
  parse: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { placeholderMatches: mocks.matches },
}));
vi.mock("../../../lib/api/client", () => ({ parserApi: { post: mocks.parse } }));
vi.mock("../../../lib/api/documents", () => ({ documentsApi: {} }));

const draft = { id: "d1", title: "Stena Kiel", kind: "ferry", day: "2026-07-03" } as PlanBooking;
vi.mock("../bookingDrafts", () => ({ bookingDrafts: () => [draft] }));

function plan(withPlaceholder: boolean) {
  const p = planFixture();
  p.state = {
    ...p.state,
    bookings: withPlaceholder
      ? [{ id: "ph", title: "Fähre (Platzhalter)", placeholder: true } as unknown as PlanBooking]
      : [],
  };
  return p;
}

async function readCandidates(
  onDraft = vi.fn(),
  onReplace = vi.fn(),
  onError = vi.fn(),
  p = plan(true)
) {
  render(<ImportPanel plan={p} onDraft={onDraft} onReplace={onReplace} onError={onError} />);
  await userEvent.type(screen.getAllByRole("textbox")[0], "booking text");
  await userEvent.click(screen.getByRole("button", { name: "parse" }));
  await userEvent.click(await screen.findByRole("button", { name: "readCandidates" }));
  return { onDraft, onReplace, onError };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parse.mockResolvedValue({ data: {} });
});

describe("import review against placeholders (spec 5.2)", () => {
  it("offers to replace the matching placeholder and keeps its id when the traveller accepts", async () => {
    mocks.matches.mockResolvedValue([
      {
        bookingId: "ph",
        score: 0.9,
        variant: "active",
        reasons: ["kind"],
        differences: [{ field: "reference", plan: null, booking: "STENA-9", change: "new" }],
      },
    ]);
    const onReplace = vi.fn().mockResolvedValue(true);
    const { onDraft } = await readCandidates(vi.fn(), onReplace);
    expect(await screen.findByText("match.field.reference")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "match.replace" }));
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith("ph", draft));
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("adds the booking as a normal draft when there is no match", async () => {
    mocks.matches.mockResolvedValue([]);
    const { onDraft } = await readCandidates();
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(draft));
  });

  it("reports a failed match lookup instead of silently adding the booking", async () => {
    mocks.matches.mockRejectedValue(new Error("down"));
    const { onDraft, onError } = await readCandidates();
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onDraft).not.toHaveBeenCalled();
  });
});
