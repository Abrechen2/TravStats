import { describe, it, expect } from '@jest/globals';
import { createCruiseSchema, updateCruiseSchema, cruiseQuerySchema } from '../cruise';

describe('cruise schemas', () => {
  const minimalValid = { status: 'scheduled' as const };

  it('accepts a minimal cruise', () => {
    expect(createCruiseSchema.safeParse(minimalValid).success).toBe(true);
  });

  it('accepts a full cruise with stops', () => {
    const result = createCruiseSchema.safeParse({
      shipId: 42,
      cruiseLine: 'AIDA Cruises',
      departurePortId: 1,
      arrivalPortId: 1,
      startDate: '2026-06-01T12:00:00Z',
      endDate: '2026-06-08T09:00:00Z',
      status: 'scheduled',
      cabinNumber: '7218',
      cabinType: 'balcony',
      deck: 7,
      bookingReference: 'AIDA-XYZ',
      price: 1299.99,
      currency: 'EUR',
      tags: ['family'],
      companions: ['Alice'],
      stops: [
        { portId: 1, dayNumber: 1, isAtSea: false, arrivalTime: '2026-06-01T12:00:00Z', departureTime: '2026-06-01T18:00:00Z' },
        { portId: null, dayNumber: 2, isAtSea: true },
        { portId: 2, dayNumber: 3, isAtSea: false, arrivalTime: '2026-06-03T07:00:00Z', departureTime: '2026-06-03T19:00:00Z', excursionNote: 'City tour' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid cabinType', () => {
    expect(createCruiseSchema.safeParse({ ...minimalValid, cabinType: 'penthouse' }).success).toBe(false);
  });

  it('rejects negative price', () => {
    expect(createCruiseSchema.safeParse({ ...minimalValid, price: -1 }).success).toBe(false);
  });

  it('rejects dayNumber < 1', () => {
    const r = createCruiseSchema.safeParse({ ...minimalValid, stops: [{ dayNumber: 0, isAtSea: true }] });
    expect(r.success).toBe(false);
  });

  it('rejects stop that is neither atSea nor has a portId', () => {
    const r = createCruiseSchema.safeParse({ ...minimalValid, stops: [{ dayNumber: 1, isAtSea: false, portId: null }] });
    expect(r.success).toBe(false);
  });

  it('rejects endDate before startDate', () => {
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      startDate: '2026-06-10T00:00:00Z',
      endDate: '2026-06-01T00:00:00Z',
    });
    expect(r.success).toBe(false);
  });

  it('coerces partial datetimes (no seconds/offset) on stops to full ISO', () => {
    // The LLM cruise parser emits times like "2026-06-15T00:00"; strict
    // datetime() would reject them and the import save would 400.
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      startDate: '2026-06-15',
      endDate: '2026-06-29T00:00',
      stops: [
        { portId: 1, dayNumber: 1, isAtSea: false, departureTime: '2026-06-15T00:00' },
        { portId: null, dayNumber: 2, isAtSea: true },
        { portId: 2, dayNumber: 3, isAtSea: false, arrivalTime: '2026-06-17T08:00' },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Coerced to a full ISO datetime (exact instant depends on the host TZ
      // for offset-less inputs; prod runs UTC). Just assert the shape is valid.
      const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(r.data.stops?.[0].departureTime).toMatch(ISO);
      expect(r.data.stops?.[2].arrivalTime).toMatch(ISO);
      // A date-only input parses as UTC midnight regardless of host TZ.
      expect(r.data.startDate).toBe('2026-06-15T00:00:00.000Z');
    }
  });

  it('still rejects a genuinely unparseable datetime', () => {
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      stops: [{ portId: 1, dayNumber: 1, isAtSea: false, arrivalTime: 'not-a-date' }],
    });
    expect(r.success).toBe(false);
  });

  it('updateCruiseSchema requires at least one field', () => {
    expect(updateCruiseSchema.safeParse({}).success).toBe(false);
  });

  it('cruiseQuerySchema accepts line filter', () => {
    expect(cruiseQuerySchema.safeParse({ cruiseLine: 'AIDA' }).success).toBe(true);
  });
});
