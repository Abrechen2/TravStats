import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourceInfoDot from "../SourceInfoDot";
import type { Flight } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

const base = { id: "1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;

it("renders nothing for a plain manual flight", () => {
  const { container } = render(
    <SourceInfoDot flight={{ ...base, dataSource: "manual" } as unknown as Flight} />
  );
  expect(container.firstChild).toBeNull();
});

it("keeps the hover path for a mouse", async () => {
  render(<SourceInfoDot flight={{ ...base, dataSource: "email_import" } as unknown as Flight} />);
  await userEvent.hover(screen.getByRole("button", { name: "flights:table.sourceInfo" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(/flights:dataSource.email_import/);
});

// forgejo#249: the provenance opens by tap and by keyboard, and closes again.
it("opens on a tap and on Enter, and closes on a second tap and on Escape", async () => {
  render(<SourceInfoDot flight={{ ...base, dataSource: "email_import" } as unknown as Flight} />);
  const dot = screen.getByRole("button", { name: "flights:table.sourceInfo" });
  await userEvent.click(dot);
  expect(screen.getByRole("dialog")).toHaveTextContent(/flights:dataSource.email_import/);
  await userEvent.click(dot);
  expect(screen.queryByRole("dialog")).toBeNull();

  dot.focus();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(dot).toHaveFocus();
});
