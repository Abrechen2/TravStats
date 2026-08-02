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

  it('accepts a date-only stop date and coerces it to UTC midnight (#132)', () => {
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      stops: [
        { portId: 1, dayNumber: 1, isAtSea: false, date: '2027-10-08' },
        { portId: null, dayNumber: 2, isAtSea: true, date: '2027-10-09' },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.stops?.[0].date).toBe('2027-10-08T00:00:00.000Z');
      expect(r.data.stops?.[1].date).toBe('2027-10-09T00:00:00.000Z');
    }
  });

  // CONTRACT CHANGE 2026-08-02: "" collapses to null (an explicit clear on
  // update), no longer to undefined — undefined told the update handler to
  // keep the old value, which made blanking the field a silent no-op.
  it('accepts routeName; the empty string collapses to null, absent stays undefined (#133)', () => {
    const withName = createCruiseSchema.safeParse({ ...minimalValid, routeName: 'Kanaren mit Marokko' });
    expect(withName.success).toBe(true);
    if (withName.success) expect(withName.data.routeName).toBe('Kanaren mit Marokko');

    const empty = createCruiseSchema.safeParse({ ...minimalValid, routeName: '' });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.routeName).toBeNull();

    const absent = createCruiseSchema.safeParse({ ...minimalValid });
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.routeName).toBeUndefined();
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

  it('accepts a valid hex color with or without the leading #', () => {
    const withHash = createCruiseSchema.safeParse({ ...minimalValid, color: '#e88374' });
    expect(withHash.success).toBe(true);
    if (withHash.success) expect(withHash.data.color).toBe('#e88374');

    const withoutHash = createCruiseSchema.safeParse({ ...minimalValid, color: 'e88374' });
    expect(withoutHash.success).toBe(true);
  });

  it('accepts an explicit null color (clears back to auto-derived)', () => {
    const r = updateCruiseSchema.safeParse({ color: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.color).toBeNull();
  });

  it('rejects an invalid hex color', () => {
    expect(createCruiseSchema.safeParse({ ...minimalValid, color: 'not-a-color' }).success).toBe(
      false,
    );
    expect(createCruiseSchema.safeParse({ ...minimalValid, color: '#ff00' }).success).toBe(false);
  });

  it('cruiseQuerySchema accepts line filter', () => {
    expect(cruiseQuerySchema.safeParse({ cruiseLine: 'AIDA' }).success).toBe(true);
  });
});

describe('stop 3-state invariant', () => {
  const withStop = (stop: Record<string, unknown>) =>
    createCruiseSchema.safeParse({ stops: [{ dayNumber: 1, ...stop }] });

  it('accepts a matched port', () => {
    expect(withStop({ portId: 5, isAtSea: false }).success).toBe(true);
  });

  it('accepts a sea day', () => {
    expect(withStop({ isAtSea: true }).success).toBe(true);
  });

  it('accepts an unresolved port', () => {
    expect(withStop({ isAtSea: false, unresolvedPortName: 'Taranto' }).success).toBe(true);
  });

  it('rejects an empty stop (no port, not at sea, no unresolved name)', () => {
    expect(withStop({ isAtSea: false }).success).toBe(false);
  });

  it('rejects portId together with unresolvedPortName', () => {
    expect(withStop({ portId: 5, isAtSea: false, unresolvedPortName: 'X' }).success).toBe(false);
  });

  it('rejects a sea day carrying an unresolved name', () => {
    expect(withStop({ isAtSea: true, unresolvedPortName: 'X' }).success).toBe(false);
  });

  it('rejects a whitespace-only unresolved name', () => {
    expect(withStop({ isAtSea: false, unresolvedPortName: '   ' }).success).toBe(false);
  });
});
