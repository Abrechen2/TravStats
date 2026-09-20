import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WhatsNewModal from "../WhatsNewModal";
import type { WhatsNewEntry } from "../../content/whatsNew";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const entry: WhatsNewEntry = {
  version: "2.4.0",
  highlights: [
    { icon: "📊", titleKey: "entries.v240.stats.title", bodyKey: "entries.v240.stats.body" },
    { icon: "✨", titleKey: "entries.v240.whatsNew.title", bodyKey: "entries.v240.whatsNew.body" },
  ],
};

describe("WhatsNewModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<WhatsNewModal isOpen={false} entry={entry} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the entry is null", () => {
    const { container } = render(<WhatsNewModal isOpen entry={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every highlight", () => {
    render(<WhatsNewModal isOpen entry={entry} onClose={vi.fn()} />);
    expect(screen.getByText("whatsNew:entries.v240.stats.title")).toBeInTheDocument();
    expect(screen.getByText("whatsNew:entries.v240.whatsNew.body")).toBeInTheDocument();
  });

  it("marks a beta highlight with the badge, and only that one", () => {
    const withBeta: WhatsNewEntry = {
      version: "2.6.0",
      highlights: [
        {
          icon: "🛂",
          titleKey: "entries.v260.countries.title",
          bodyKey: "entries.v260.countries.body",
        },
        {
          icon: "🧪",
          titleKey: "entries.v260.beta.title",
          bodyKey: "entries.v260.beta.body",
          beta: true,
        },
      ],
    };
    render(<WhatsNewModal isOpen entry={withBeta} onClose={vi.fn()} />);
    expect(screen.getAllByText("whatsNew:betaBadge")).toHaveLength(1);
    expect(screen.getByText("whatsNew:entries.v260.beta.title")).toHaveTextContent(
      "whatsNew:betaBadge"
    );
    expect(screen.getByText("whatsNew:entries.v260.countries.title")).not.toHaveTextContent(
      "whatsNew:betaBadge"
    );
  });

  /**
   * Owner decision 2026-09-20, from the beta audit of 2026-09-19: this dialog
   * is dismissed reflexively, so the telemetry consent that used to sit at the
   * bottom of it was being answered by a click that meant "close the release
   * notes". It is its own step now — nothing here asks a question.
   */
  it("carries no consent block and no slot to put one in", () => {
    render(<WhatsNewModal isOpen entry={entry} onClose={vi.fn()} />);
    expect(screen.queryByTestId("whats-new-extra-slot")).not.toBeInTheDocument();
    expect(screen.queryByText(/usageStats:consent/)).not.toBeInTheDocument();
    // The two answers, by their accessible names — the shape the card had.
    expect(screen.queryByRole("button", { name: /consent\.accept/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /consent\.decline/ })).not.toBeInTheDocument();
    // Only the dismiss button and the header ×.
    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)
    ).toEqual(["common:buttons.close", "whatsNew:dismiss"]);
  });

  it("calls onClose from the dismiss button", async () => {
    const onClose = vi.fn();
    render(<WhatsNewModal isOpen entry={entry} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "whatsNew:dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
