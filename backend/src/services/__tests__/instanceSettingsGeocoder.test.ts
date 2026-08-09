jest.mock("../../db", () => ({
  prisma: {
    adminSettings: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import {
  getInstanceSettings,
  updateInstanceSettings,
  resolveGeocoderUrls,
} from "../instanceSettingsService";
import { prisma } from "../../db";

const mockPrisma = prisma as unknown as {
  adminSettings: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
};

const DEFAULT_PHOTON_URL = "https://photon.komoot.io";
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org";

describe("geocoder URL resolution (DB > ENV > default)", () => {
  const realEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PHOTON_URL;
    delete process.env.NOMINATIM_URL;
  });

  afterAll(() => {
    process.env = realEnv;
  });

  it("falls back to the public default when neither DB nor ENV is set", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({
      id: 1,
      photonUrl: null,
      nominatimUrl: null,
    });
    const settings = await getInstanceSettings();
    expect(settings.photonUrl).toBe(DEFAULT_PHOTON_URL);
    expect(settings.nominatimUrl).toBe(DEFAULT_NOMINATIM_URL);
  });

  it("prefers ENV over the built-in default", async () => {
    process.env.PHOTON_URL = "https://photon.env.example";
    process.env.NOMINATIM_URL = "https://nominatim.env.example";
    mockPrisma.adminSettings.findFirst.mockResolvedValue({
      id: 1,
      photonUrl: null,
      nominatimUrl: null,
    });
    const settings = await getInstanceSettings();
    expect(settings.photonUrl).toBe("https://photon.env.example");
    expect(settings.nominatimUrl).toBe("https://nominatim.env.example");
  });

  it("prefers the DB value over ENV and the default", async () => {
    process.env.PHOTON_URL = "https://photon.env.example";
    process.env.NOMINATIM_URL = "https://nominatim.env.example";
    mockPrisma.adminSettings.findFirst.mockResolvedValue({
      id: 1,
      photonUrl: "https://photon.db.example",
      nominatimUrl: "https://nominatim.db.example",
    });
    const settings = await getInstanceSettings();
    expect(settings.photonUrl).toBe("https://photon.db.example");
    expect(settings.nominatimUrl).toBe("https://nominatim.db.example");
  });

  it("resolveGeocoderUrls exposes the same resolution as getInstanceSettings", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({
      id: 1,
      photonUrl: "https://photon.db.example",
      nominatimUrl: null,
    });
    const urls = await resolveGeocoderUrls();
    expect(urls).toEqual({
      photonUrl: "https://photon.db.example",
      nominatimUrl: DEFAULT_NOMINATIM_URL,
    });
  });
});

describe("clearing a geocoder URL via updateInstanceSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PHOTON_URL;
    delete process.env.NOMINATIM_URL;
  });

  it("writes null to the DB when patched with an empty string, reverting to the default", async () => {
    mockPrisma.adminSettings.findFirst
      .mockResolvedValueOnce({
        id: 1,
        photonUrl: "https://photon.db.example",
        nominatimUrl: null,
      })
      .mockResolvedValueOnce({ id: 1, photonUrl: null, nominatimUrl: null });

    const settings = await updateInstanceSettings({ photonUrl: "" });

    expect(mockPrisma.adminSettings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { photonUrl: null },
    });
    expect(settings.photonUrl).toBe(DEFAULT_PHOTON_URL);
  });

  it("writes a new URL through untouched", async () => {
    mockPrisma.adminSettings.findFirst
      .mockResolvedValueOnce({ id: 1, photonUrl: null, nominatimUrl: null })
      .mockResolvedValueOnce({
        id: 1,
        photonUrl: null,
        nominatimUrl: "https://nominatim.self-hosted.example",
      });

    const settings = await updateInstanceSettings({
      nominatimUrl: "https://nominatim.self-hosted.example",
    });

    expect(mockPrisma.adminSettings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { nominatimUrl: "https://nominatim.self-hosted.example" },
    });
    expect(settings.nominatimUrl).toBe("https://nominatim.self-hosted.example");
  });
});
