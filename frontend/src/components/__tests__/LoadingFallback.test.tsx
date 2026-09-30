import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import commonDe from "../../i18n/resources/de/common.json";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const [, path] = key.split(":");
      const raw = path
        .split(".")
        .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], commonDe);
      return typeof raw === "string" ? raw : key;
    },
  }),
}));

import LoadingFallback from "../LoadingFallback";

/** Acceptance 2026-09-26: the German UI showed "Loading... / Please wait...". */
describe("LoadingFallback", () => {
  it("waits in the reader's language", () => {
    render(<LoadingFallback />);
    expect(screen.getByText(commonDe.loading.title)).toBeInTheDocument();
    expect(screen.getByText(commonDe.loading.pleaseWait)).toBeInTheDocument();
    expect(screen.queryByText(/Please wait/)).toBeNull();
  });
});
