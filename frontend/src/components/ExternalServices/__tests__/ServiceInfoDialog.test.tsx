import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// A copy file that has no key link of its own: every unknown key reads as its default.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string }) =>
      key.endsWith(".getKeyUrl") || key.endsWith(".getKeyLabel") ? (o?.defaultValue ?? "") : key,
  }),
}));

import ServiceInfoDialog from "../ServiceInfoDialog";

describe("ServiceInfoDialog", () => {
  it("falls back to the catalogue's getKeyUrl when the copy carries no key link", () => {
    render(
      <ServiceInfoDialog
        serviceId="strava"
        level="instanceAndAccount"
        recommended={null}
        scope="admin"
        getKeyUrl="https://www.strava.com/settings/api"
        onClose={() => undefined}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://www.strava.com/settings/api");
  });
});
