import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import DomainColorSection from "../DomainColorSection";

const mockBeta = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: (key: string) => key === "roadtrips" && mockBeta() }),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("DomainColorSection", () => {
  it("offers no roadtrip colour while the roadtrips beta is closed, and offers it once open", () => {
    const { unmount } = render(<DomainColorSection />);
    expect(screen.queryByLabelText(/roadtrip/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/flight/i)).toBeInTheDocument();
    unmount();

    mockBeta.mockReturnValue(true);
    render(<DomainColorSection />);
    expect(screen.getByLabelText(/roadtrip/i)).toBeInTheDocument();
  });
});
