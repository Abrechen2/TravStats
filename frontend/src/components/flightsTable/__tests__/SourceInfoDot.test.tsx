import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SourceInfoDot from "../SourceInfoDot";
import type { Flight } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

const base = { id: "1", depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 } as unknown as Flight;

it("renders nothing for a plain manual flight", () => {
  const { container } = render(<SourceInfoDot flight={{ ...base, dataSource: "manual" } as unknown as Flight} />);
  expect(container.firstChild).toBeNull();
});

it("shows the tooltip on click (touch fallback) and hides on second click", () => {
  render(<SourceInfoDot flight={{ ...base, dataSource: "email_import" } as unknown as Flight} />);
  const dot = screen.getByRole("button");
  fireEvent.click(dot);
  expect(screen.getByText(/flights:dataSource.email_import/)).toBeInTheDocument();
  fireEvent.click(dot);
  expect(screen.queryByText(/flights:dataSource.email_import/)).not.toBeInTheDocument();
});
