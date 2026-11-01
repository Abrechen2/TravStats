import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/client", () => ({ api: { get } }));
vi.mock("../../../lib/export", () => ({ downloadBlob: save }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import GeoExportButtons from "../GeoExportButtons";

describe("GeoExportButtons (forgejo#402)", () => {
  beforeEach(() => {
    get.mockReset();
    save.mockReset();
  });

  it("asks the route for the chosen format and saves the file under the server's name", async () => {
    get.mockResolvedValue({
      data: new Blob(["<gpx/>"]),
      headers: { "content-disposition": 'attachment; filename="2026-05-02_Flight.kml"' },
    });
    render(<GeoExportButtons path="/flights/f1/track/export" />);
    await userEvent.click(screen.getByTestId("geo-export-kml"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith("/flights/f1/track/export", {
      responseType: "blob",
      params: { format: "kml" },
    });
    expect(save.mock.calls[0]![1]).toBe("2026-05-02_Flight.kml");
  });

  it("says there is nothing to export on a 422, not that the download failed", async () => {
    get.mockRejectedValue({ response: { status: 422 } });
    render(<GeoExportButtons path="/places/export" params={{ listId: "l1" }} />);
    await userEvent.click(screen.getByTestId("geo-export-gpx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("common:geoExport.empty");
    expect(get.mock.calls[0]![1].params).toEqual({ listId: "l1", format: "gpx" });
    expect(save).not.toHaveBeenCalled();
  });

  it("says the export failed on any other error", async () => {
    get.mockRejectedValue({ response: { status: 500 } });
    render(<GeoExportButtons path="/places/export" />);
    await userEvent.click(screen.getByTestId("geo-export-gpx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("common:geoExport.error");
  });
});
