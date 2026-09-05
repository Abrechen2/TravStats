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

  it("renders the extraSlot when provided", () => {
    render(
      <WhatsNewModal isOpen entry={entry} onClose={vi.fn()} extraSlot={<p>consent card</p>} />
    );
    expect(screen.getByText("consent card")).toBeInTheDocument();
  });

  it("omits the slot region entirely when not provided", () => {
    render(<WhatsNewModal isOpen entry={entry} onClose={vi.fn()} />);
    expect(screen.queryByTestId("whats-new-extra-slot")).not.toBeInTheDocument();
  });

  it("calls onClose from the dismiss button", async () => {
    const onClose = vi.fn();
    render(<WhatsNewModal isOpen entry={entry} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "whatsNew:dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
