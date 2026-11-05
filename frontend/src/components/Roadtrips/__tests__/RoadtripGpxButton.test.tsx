import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import RoadtripGpxButton from "../RoadtripGpxButton";
import { toursApi } from "../../../lib/api/tours";
import { downloadBlob } from "../../../lib/export";

vi.mock("../../../lib/api/tours", () => ({ toursApi: { geometry: vi.fn() } }));
vi.mock("../../../lib/export", async (orig) => ({
  ...(await orig<typeof import("../../../lib/export")>()),
  downloadBlob: vi.fn(),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const press = (el: HTMLElement): Promise<void> =>
  act(async () => {
    fireEvent.click(el);
  });

describe("RoadtripGpxButton", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("saves the file with the freshly fetched lines", async () => {
    vi.mocked(toursApi.geometry).mockResolvedValue({ type: "FeatureCollection", features: [] });
    render(<RoadtripGpxButton routeId="r" name="Alpen" stations={[]} />);
    await press(screen.getByRole("button"));
    expect(toursApi.geometry).toHaveBeenCalledWith(undefined, "r");
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "alpen.gpx");
  });

  it("saves nothing and says so when the route lines cannot be loaded", async () => {
    vi.mocked(toursApi.geometry).mockRejectedValue(new Error("500"));
    render(<RoadtripGpxButton routeId="r" name="Alpen" stations={[]} />);
    await press(screen.getByRole("button"));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("roadtrips:gpx.failed");
  });
});
