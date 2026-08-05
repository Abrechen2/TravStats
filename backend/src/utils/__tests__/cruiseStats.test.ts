import { describe, it, expect } from '@jest/globals';
import { calculateCruiseStats, type CruiseData, type CruisePortData } from '../cruiseStats';

const port = (id: number, region: string, country: string, unlocode: string | null = null): CruisePortData => ({
  id,
  name: `P${id}`,
  city: null,
  country,
  region,
  unlocode,
  lat: 0,
  lon: 0,
  timezone: null,
  isUserAdded: false,
});

describe('calculateCruiseStats', () => {
  const sampleCruises: CruiseData[] = [
    {
      id: 'c1',
      shipId: 1,
      cruiseLine: 'AIDA Cruises',
      cabinType: 'balcony',
      deck: 7,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-08'),
      stops: [
        { portId: 1, port: port(1, 'mediterranean', 'Spain'), dayNumber: 1, isAtSea: false },
        { portId: null, port: null, dayNumber: 2, isAtSea: true },
        { portId: null, port: null, dayNumber: 3, isAtSea: true },
        { portId: 2, port: port(2, 'mediterranean', 'France'), dayNumber: 4, isAtSea: false },
      ],
    },
    {
      id: 'c2',
      shipId: 2,
      cruiseLine: 'TUI Cruises',
      cabinType: 'suite',
      deck: 14,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-08'),
      stops: [
        { portId: 3, port: port(3, 'caribbean', 'Bahamas'), dayNumber: 1, isAtSea: false },
        { portId: 4, port: port(4, 'caribbean', 'Puerto Rico'), dayNumber: 2, isAtSea: false },
      ],
    },
  ];

  it('counts cruises', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.cruisesCount).toBe(2);
  });

  it('counts unique ports and ships', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.cruisePortsUnique).toBe(4);
    expect(s.cruiseShipsUnique).toBe(2);
  });

  it('counts sea days total and max streak', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.seaDays).toBe(2);
    expect(s.seaDaysStreak).toBe(2);
  });

  it('tracks max ports in a single cruise', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.cruisePortsSingleMax).toBe(2);
  });

  it('tracks unique lines and loyalty count', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.cruiseLinesUnique).toBe(2);
    expect(s.cruiseLineLoyaltyMax).toBe(1);
  });

  it('tracks cruise line loyalty correctly for repeated line', () => {
    const cruises: CruiseData[] = [
      { ...sampleCruises[0], id: 'c1', cruiseLine: 'AIDA Cruises' },
      { ...sampleCruises[0], id: 'c2', cruiseLine: 'AIDA Cruises' },
      { ...sampleCruises[0], id: 'c3', cruiseLine: 'AIDA Cruises' },
    ];
    const s = calculateCruiseStats(cruises);
    expect(s.cruiseLineLoyaltyMax).toBe(3);
    expect(s.cruiseLinesUnique).toBe(1);
  });

  it('exposes region flags via Set', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.regions.has('mediterranean')).toBe(true);
    expect(s.regions.has('caribbean')).toBe(true);
    expect(s.regions.has('baltic')).toBe(false);
  });

  it('picks cabin tier flags + max deck', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.hasBalconyCabin).toBe(true);
    expect(s.hasSuiteCabin).toBe(true);
    expect(s.maxDeck).toBe(14);
  });

  it('countries Set includes ports countries', () => {
    const s = calculateCruiseStats(sampleCruises);
    expect(s.countries.has('Spain')).toBe(true);
    expect(s.countries.has('Bahamas')).toBe(true);
  });

  it('detects canal transit by UNLOCODE', () => {
    const cruises: CruiseData[] = [{
      id: 'cc',
      shipId: 1,
      cruiseLine: null,
      cabinType: null,
      deck: null,
      startDate: null,
      endDate: null,
      stops: [
        { portId: 1, port: port(1, 'atlantic', 'Panama', 'PACTB'), dayNumber: 1, isAtSea: false },
      ],
    }];
    const s = calculateCruiseStats(cruises);
    expect(s.hasCanalTransit).toBe(true);
  });

  it('detects polar via region', () => {
    const cruises: CruiseData[] = [{
      id: 'cc',
      shipId: 1,
      cruiseLine: null,
      cabinType: null,
      deck: null,
      startDate: null,
      endDate: null,
      stops: [{ portId: 1, port: port(1, 'polar', 'Antarctica'), dayNumber: 1, isAtSea: false }],
    }];
    const s = calculateCruiseStats(cruises);
    expect(s.hasPolar).toBe(true);
  });

  it('detects cold water via region=alaska', () => {
    const cruises: CruiseData[] = [{
      id: 'cc',
      shipId: 1,
      cruiseLine: null,
      cabinType: null,
      deck: null,
      startDate: null,
      endDate: null,
      stops: [{ portId: 1, port: port(1, 'alaska', 'United States'), dayNumber: 1, isAtSea: false }],
    }];
    const s = calculateCruiseStats(cruises);
    expect(s.hasColdWater).toBe(true);
  });

  it('detects new years at sea', () => {
    const cruises: CruiseData[] = [{
      id: 'ny',
      shipId: 1,
      cruiseLine: null,
      cabinType: null,
      deck: null,
      startDate: new Date('2026-12-28T00:00:00Z'),
      endDate: new Date('2027-01-04T00:00:00Z'),
      stops: [
        { portId: null, port: null, dayNumber: 1, isAtSea: true },
      ],
    }];
    const s = calculateCruiseStats(cruises);
    expect(s.hasNewYearsAtSea).toBe(true);
  });

  it('detects birthday at sea when user birthday falls within cruise range', () => {
    const cruises: CruiseData[] = [{
      id: 'bd',
      shipId: 1,
      cruiseLine: null,
      cabinType: null,
      deck: null,
      startDate: new Date('2026-06-05T00:00:00Z'),
      endDate: new Date('2026-06-12T00:00:00Z'),
      stops: [],
    }];
    const s = calculateCruiseStats(cruises, { month: 6, day: 8 });
    expect(s.hasBirthdayAtSea).toBe(true);
  });

  it('returns zero stats for empty input', () => {
    const s = calculateCruiseStats([]);
    expect(s.cruisesCount).toBe(0);
    expect(s.cruisePortsUnique).toBe(0);
    expect(s.seaDays).toBe(0);
    expect(s.hasBalconyCabin).toBe(false);
    expect(s.regions.size).toBe(0);
  });

  it('uses persisted legDistancesKm when length matches port-call count - 1', () => {
    const cruises: CruiseData[] = [
      {
        id: 'c-legs',
        shipId: null,
        cruiseLine: null,
        cabinType: null,
        deck: null,
        startDate: null,
        endDate: null,
        stops: [
          { portId: 1, port: port(1, 'baltic', 'DE'), dayNumber: 1, isAtSea: false },
          { portId: null, port: null, dayNumber: 2, isAtSea: true },
          { portId: 2, port: port(2, 'baltic', 'DK'), dayNumber: 3, isAtSea: false },
          { portId: 3, port: port(3, 'baltic', 'SE'), dayNumber: 4, isAtSea: false },
        ],
        // 3 port calls → 2 legs. Numbers chosen unrealistically large
        // so a haversine fallback (~0 km, since all ports share lat/lon)
        // would clearly not produce them.
        legDistancesKm: [1234.5, 678.9],
      },
    ];
    const s = calculateCruiseStats(cruises);
    expect(s.totalDistanceKm).toBeCloseTo(1234.5 + 678.9, 1);
    expect(s.longestLegKm).toBeCloseTo(1234.5, 1);
  });

  it('falls back to haversine when persisted legs are stale (length mismatch)', () => {
    const cruises: CruiseData[] = [
      {
        id: 'c-stale',
        shipId: null,
        cruiseLine: null,
        cabinType: null,
        deck: null,
        startDate: null,
        endDate: null,
        stops: [
          { portId: 1, port: port(1, 'baltic', 'DE'), dayNumber: 1, isAtSea: false },
          { portId: 2, port: port(2, 'baltic', 'DK'), dayNumber: 2, isAtSea: false },
        ],
        // 2 port calls → expects 1 leg, but we provide 5 stale ones.
        legDistancesKm: [9999, 9999, 9999, 9999, 9999],
      },
    ];
    const s = calculateCruiseStats(cruises);
    // Both ports have lat/lon = 0 (test fixture default), so haversine = 0.
    // If the stale legs were used, distance would be > 0.
    expect(s.totalDistanceKm).toBe(0);
  });

  it('includes departure/arrival ports in port, country and region stats', () => {
    const cruises: CruiseData[] = [
      {
        id: 'c-deparr',
        shipId: null,
        cruiseLine: null,
        cabinType: null,
        deck: null,
        startDate: null,
        endDate: null,
        departurePort: port(10, 'northern-europe', 'Germany'),
        arrivalPort: port(11, 'iberian-atlantic', 'Portugal'),
        stops: [{ portId: null, port: null, dayNumber: 1, isAtSea: true }],
      },
    ];
    const s = calculateCruiseStats(cruises);
    expect(s.cruisePortsUnique).toBe(2);
    expect(s.totalPortCalls).toBe(2);
    expect(s.countries.has('Germany')).toBe(true);
    expect(s.countries.has('Portugal')).toBe(true);
    expect(s.regions.has('northern-europe')).toBe(true);
  });

  it('does not double-count departure/arrival that duplicate first/last port call', () => {
    const cruises: CruiseData[] = [
      {
        id: 'c-dup',
        shipId: null,
        cruiseLine: null,
        cabinType: null,
        deck: null,
        startDate: null,
        endDate: null,
        departurePort: port(1, 'baltic', 'DE'),
        arrivalPort: port(2, 'baltic', 'DK'),
        stops: [
          { portId: 1, port: port(1, 'baltic', 'DE'), dayNumber: 1, isAtSea: false },
          { portId: 2, port: port(2, 'baltic', 'DK'), dayNumber: 2, isAtSea: false },
        ],
      },
    ];
    const s = calculateCruiseStats(cruises);
    expect(s.totalPortCalls).toBe(2);
    expect(s.cruisePortsUnique).toBe(2);
  });

  it('accepts persisted legs sized to the effective sequence (dep + stops + arr)', () => {
    const cruises: CruiseData[] = [
      {
        id: 'c-eff-legs',
        shipId: null,
        cruiseLine: null,
        cabinType: null,
        deck: null,
        startDate: null,
        endDate: null,
        departurePort: port(10, 'northern-europe', 'Germany'),
        arrivalPort: port(11, 'iberian-atlantic', 'Portugal'),
        stops: [{ portId: 1, port: port(1, 'channel', 'UK'), dayNumber: 1, isAtSea: false }],
        // Effective sequence: dep(10) → 1 → arr(11) = 3 port calls → 2 legs.
        legDistancesKm: [700.5, 800.25],
      },
    ];
    const s = calculateCruiseStats(cruises);
    expect(s.totalDistanceKm).toBeCloseTo(700.5 + 800.25, 1);
    expect(s.longestLegKm).toBeCloseTo(800.25, 1);
  });
});

describe('unresolved stops count as port calls', () => {
  it('adds an unresolved stop to totalPortCalls but not to unique ports', () => {
    const cruises: CruiseData[] = [
      {
        id: 'c1',
        shipId: null,
        cruiseLine: null,
        cabinType: null,
        deck: null,
        startDate: null,
        endDate: null,
        stops: [
          { portId: 1, port: port(1, 'baltic', 'Germany', 'DEKEL'), dayNumber: 1, isAtSea: false },
          { portId: null, port: null, dayNumber: 2, isAtSea: true },
          {
            portId: null,
            port: null,
            dayNumber: 3,
            isAtSea: false,
            unresolvedPortName: 'Taranto',
          },
        ],
      },
    ];
    const s = calculateCruiseStats(cruises);
    expect(s.totalPortCalls).toBe(2); // Kiel + Taranto
    expect(s.cruisePortsUnique).toBe(1); // only the matched Kiel
    expect(s.seaDays).toBe(1);
  });

});

// The "countries visited" KPI used to render the LIFETIME country set no
// matter which year was selected, and a delta badge on top of it that was
// structurally always zero. These pin the year-keyed index that replaced it.
describe('countriesByYear', () => {
    it('buckets each cruise\'s countries under its start year', () => {
      const cruises: CruiseData[] = [
        {
          id: 'c1',
          shipId: 1,
          cruiseLine: null,
          cabinType: null,
          deck: null,
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-06-08'),
          stops: [
            { portId: 1, port: port(1, 'mediterranean', 'Spain'), dayNumber: 1, isAtSea: false },
            { portId: 2, port: port(2, 'mediterranean', 'France'), dayNumber: 2, isAtSea: false },
          ],
        },
        {
          id: 'c2',
          shipId: 2,
          cruiseLine: null,
          cabinType: null,
          deck: null,
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-08'),
          stops: [
            { portId: 3, port: port(3, 'caribbean', 'Bahamas'), dayNumber: 1, isAtSea: false },
          ],
        },
      ];
      const s = calculateCruiseStats(cruises);
      expect([...(s.countriesByYear.get(2026) ?? [])].sort()).toEqual([
        'Bahamas',
        'France',
        'Spain',
      ]);
    });

    it('keeps years apart instead of unioning them', () => {
      const cruises: CruiseData[] = [
        {
          id: 'a',
          shipId: 1,
          cruiseLine: null,
          cabinType: null,
          deck: null,
          startDate: new Date('2024-05-01'),
          endDate: new Date('2024-05-08'),
          stops: [
            { portId: 1, port: port(1, 'baltic', 'Norway'), dayNumber: 1, isAtSea: false },
          ],
        },
        {
          id: 'b',
          shipId: 1,
          cruiseLine: null,
          cabinType: null,
          deck: null,
          startDate: new Date('2026-05-01'),
          endDate: new Date('2026-05-08'),
          stops: [
            { portId: 2, port: port(2, 'caribbean', 'Aruba'), dayNumber: 1, isAtSea: false },
          ],
        },
      ];
      const s = calculateCruiseStats(cruises);
      expect([...(s.countriesByYear.get(2024) ?? [])]).toEqual(['Norway']);
      expect([...(s.countriesByYear.get(2026) ?? [])]).toEqual(['Aruba']);
      // The lifetime set still carries both — the tile falls back to it when
      // no year is selected.
      expect([...s.countries].sort()).toEqual(['Aruba', 'Norway']);
    });

    it('leaves a cruise without a start date out of every year bucket but keeps it lifetime', () => {
      const cruises: CruiseData[] = [
        {
          id: 'undated',
          shipId: null,
          cruiseLine: null,
          cabinType: null,
          deck: null,
          startDate: null,
          endDate: null,
          stops: [
            { portId: 1, port: port(1, 'baltic', 'Estonia'), dayNumber: 1, isAtSea: false },
          ],
        },
      ];
      const s = calculateCruiseStats(cruises);
      expect(s.countriesByYear.size).toBe(0);
      expect([...s.countries]).toEqual(['Estonia']);
    });

    it('reads the start year in UTC, so a date-only start does not slip a year in a western timezone', () => {
      // Cruise dates are stored date-only, UTC-pinned (see the cruise-input
      // fix). Deriving the year with local getFullYear() would move a
      // 1 January start into the previous year for anyone west of UTC.
      const cruises: CruiseData[] = [
        {
          id: 'newyear',
          shipId: null,
          cruiseLine: null,
          cabinType: null,
          deck: null,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-01-08T00:00:00.000Z'),
          stops: [
            { portId: 1, port: port(1, 'caribbean', 'Barbados'), dayNumber: 1, isAtSea: false },
          ],
        },
      ];
      const s = calculateCruiseStats(cruises);
      expect([...(s.countriesByYear.get(2026) ?? [])]).toEqual(['Barbados']);
      expect(s.countriesByYear.has(2025)).toBe(false);
    });
});
