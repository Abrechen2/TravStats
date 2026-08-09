import { lookupFlightWithHistorical } from '../flightLookup';

/**
 * Issue #232. On a fresh install with no flight-data provider configured,
 * searching a flight answered "Keine Flüge gefunden. Bitte versuchen Sie ein
 * anderes Datum" — nothing had been searched at all.
 *
 * The backend already distinguished one unavailable case, but its capability
 * gate only ran for dates OUTSIDE the live window. A search for TODAY with no
 * keys fell through the whole cascade and came back as an ordinary empty
 * result, so "not configured" was reported as "not found". Those call for
 * opposite actions: add a key in Settings, versus try another date.
 */
jest.mock('../apiKeyResolver', () => ({
  getApiKey: jest.fn(async () => null),
  getOpenSkyCredentials: jest.fn(async () => null),
}));

const resolver = jest.requireMock('../apiKeyResolver') as {
  getApiKey: jest.Mock;
  getOpenSkyCredentials: jest.Mock;
};

describe('lookupFlightWithHistorical — nothing configured (#232)', () => {
  beforeEach(() => {
    resolver.getApiKey.mockResolvedValue(null);
    resolver.getOpenSkyCredentials.mockResolvedValue(null);
  });

  it("reports 'not_configured' for TODAY when no provider is configured", async () => {
    const result = await lookupFlightWithHistorical('LH400', new Date());
    expect(result.flights).toEqual([]);
    expect(result.unavailableReason).toBe('not_configured');
  });

  it("reports 'not_configured' for a dateless ad-hoc lookup too", async () => {
    const result = await lookupFlightWithHistorical('LH400');
    expect(result.unavailableReason).toBe('not_configured');
  });

  it("reports 'not_configured' rather than 'no_provider' for a past date", async () => {
    // With NOTHING configured the honest answer is "configure a provider",
    // not "this date needs a paid tier" — the latter implies the free ones
    // are set up and merely limited.
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = await lookupFlightWithHistorical('LH400', past);
    expect(result.unavailableReason).toBe('not_configured');
  });

  it("still reports 'no_provider' for a past date when a live provider IS configured", async () => {
    // AirLabs present, but neither Aviationstack nor AeroDataBox: the
    // pre-existing capability gate must keep its own, more specific answer.
    resolver.getApiKey.mockImplementation(async (provider: string) =>
      provider === 'airlabs' ? 'a-key' : null
    );
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = await lookupFlightWithHistorical('LH400', past);
    expect(result.unavailableReason).toBe('no_provider');
  });
});
