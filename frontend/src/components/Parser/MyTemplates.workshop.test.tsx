import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyTemplates from "./MyTemplates";
import AnnotationLabelSelect from "../Training/AnnotationLabelSelect";
import DomainPicker from "./DomainPicker";

/**
 * forgejo#124 phase 6, from the user's side.
 *
 * Three things the page has to get right, each of which it got wrong before:
 * the labels on offer belong to the document's domain (a hotel mail was
 * annotated with "Gate"); a template cannot be switched on before it has
 * been seen reading something; and a domain the workshop cannot derive for
 * says so, rather than looking like it worked.
 */

const preview = vi.fn();
const setStatus = vi.fn();

vi.mock("../../lib/api", () => ({
  parserTemplatesApi: {
    list: vi.fn().mockResolvedValue([
      {
        id: "t1",
        name: "hotel-beispiel.test",
        domain: "lodging",
        status: "pending",
        createdAt: "2026-09-19T10:00:00.000Z",
        updatedAt: "2026-09-19T10:00:00.000Z",
      },
    ]),
    preview: (id: string) => preview(id),
    setStatus: (id: string, status: string) => setStatus(id, status),
    delete: vi.fn(),
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: unknown }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../lib/logger", () => ({ logger: { error: vi.fn() } }));

vi.mock("../../hooks/useMinLoadingState", () => ({
  useMinLoadingState: (loading: boolean) => loading,
}));

describe("the workshop's template list", () => {
  beforeEach(() => {
    preview.mockReset();
    setStatus.mockReset();
  });

  it("will not activate a template that has not been previewed", async () => {
    render(<MyTemplates />);
    const activate = await screen.findByTestId("activate-t1");
    expect(activate).toBeDisabled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("shows what the template read, on its own sample and a held-out one, then allows activation", async () => {
    preview.mockResolvedValue({
      templateId: "t1",
      domain: "lodging",
      own: {
        sampleId: "s1",
        filename: null,
        result: {
          matched: true,
          fields: [{ name: "hotelName", value: "Hotel Beispiel Nürnberg" }],
          confidence: 75,
        },
      },
      heldOut: {
        sampleId: "s2",
        filename: null,
        result: {
          matched: true,
          fields: [{ name: "hotelName", value: "Hotel Beispiel Hamburg" }],
          confidence: 75,
        },
      },
      heldOutReason: null,
      canActivate: true,
      patternsHash: "abc123",
    });

    render(<MyTemplates />);
    await userEvent.click(await screen.findByTestId("preview-t1"));

    await waitFor(() => expect(screen.getByText(/Hotel Beispiel Nürnberg/)).toBeInTheDocument());
    // The held-out mail is the evidence that matters: without it the preview
    // only says the patterns were copied out of their own source correctly.
    expect(screen.getByText(/Hotel Beispiel Hamburg/)).toBeInTheDocument();
    expect(screen.getByTestId("activate-t1")).not.toBeDisabled();
  });

  it("keeps activation shut when the preview read nothing", async () => {
    preview.mockResolvedValue({
      templateId: "t1",
      domain: "lodging",
      own: {
        sampleId: "s1",
        filename: null,
        result: { matched: false, fields: [], confidence: null },
      },
      heldOut: null,
      heldOutReason: "noSecondSample",
      canActivate: false,
      patternsHash: "abc123",
    });

    render(<MyTemplates />);
    await userEvent.click(await screen.findByTestId("preview-t1"));

    await waitFor(() =>
      expect(screen.getByText("parser:preview.cannotActivate")).toBeInTheDocument()
    );
    expect(screen.getByTestId("activate-t1")).toBeDisabled();
  });
});

describe("the annotation label set", () => {
  it("offers a hotel mail's own fields, and none of the flight ones", () => {
    render(<AnnotationLabelSelect domain="lodging" value="" onChange={vi.fn()} />);
    expect(
      screen.getByRole("option", { name: "parser:labels.lodging.checkIn" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "parser:labels.flight.flightNumber" })).toBeNull();
  });

  it("offers the flight fields for a flight mail", () => {
    render(<AnnotationLabelSelect domain="flight" value="" onChange={vi.fn()} />);
    expect(
      screen.getByRole("option", { name: "parser:labels.flight.flightNumber" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "parser:labels.lodging.checkIn" })).toBeNull();
  });
});

describe("the domain picker", () => {
  it("says a cruise cannot be derived, before the annotating rather than after", () => {
    render(<DomainPicker value="cruise" detected="cruise" onChange={vi.fn()} />);
    expect(
      screen.getByText("parser:derivation.cannot.cruiseNeedsRepeatingBlocks")
    ).toBeInTheDocument();
  });

  it("says nothing of the sort for a domain it can derive", () => {
    render(<DomainPicker value="lodging" detected="lodging" onChange={vi.fn()} />);
    expect(screen.queryByText(/derivation\.cannot/)).toBeNull();
  });
});
