import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import RoadtripVehicleSelect from "../RoadtripVehicleSelect";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import type { TourRoute } from "../../../types/tour";

vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { switchKind: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const route = { id: "r1", vehicle: "car" } as unknown as TourRoute;

const choose = (value: string): Promise<void> =>
  act(async () => {
    fireEvent.change(screen.getByRole("combobox"), { target: { value } });
  });

describe("RoadtripVehicleSelect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changes the vehicle of an existing roadtrip", async () => {
    const saved = { ...route, vehicle: "campervan" } as unknown as TourRoute;
    vi.mocked(roadtripsApi.switchKind).mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<RoadtripVehicleSelect route={route} onSaved={onSaved} />);
    await choose("campervan");
    expect(roadtripsApi.switchKind).toHaveBeenCalledWith("r1", {
      kind: "roadtrip",
      vehicle: "campervan",
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("says so and keeps the stored vehicle when the change is refused", async () => {
    vi.mocked(roadtripsApi.switchKind).mockRejectedValue(new Error("500"));
    const onSaved = vi.fn();
    render(<RoadtripVehicleSelect route={route} onSaved={onSaved} />);
    await choose("campervan");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("car");
  });
});
