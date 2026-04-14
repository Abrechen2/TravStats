import {
  applyHomeAirportMove,
  getCurrentHomeAirport,
  getHomeAirportAt,
  normalizeHistory,
  sortHistory,
} from '../utils/homeAirport';

describe('homeAirport utils', () => {
  describe('getHomeAirportAt', () => {
    const history = [
      { iata: 'MUC', fromDate: '2018-01-01', toDate: '2024-06-01' },
      { iata: 'BER', fromDate: '2024-06-01', toDate: null },
    ];

    it('returns the airport active for the given date', () => {
      expect(getHomeAirportAt(history, '2020-03-15')).toBe('MUC');
      expect(getHomeAirportAt(history, '2024-05-31')).toBe('MUC');
      expect(getHomeAirportAt(history, '2024-06-01')).toBe('BER');
      expect(getHomeAirportAt(history, '2026-04-14')).toBe('BER');
    });

    it('returns null when date is before any entry', () => {
      expect(getHomeAirportAt(history, '2015-01-01')).toBeNull();
    });

    it('returns null for empty or missing history', () => {
      expect(getHomeAirportAt([], '2024-01-01')).toBeNull();
      expect(getHomeAirportAt(null, '2024-01-01')).toBeNull();
      expect(getHomeAirportAt(undefined, '2024-01-01')).toBeNull();
    });
  });

  describe('getCurrentHomeAirport', () => {
    it('returns the entry with open end', () => {
      const history = [
        { iata: 'MUC', fromDate: '2018-01-01', toDate: '2024-06-01' },
        { iata: 'BER', fromDate: '2024-06-01', toDate: null },
      ];
      expect(getCurrentHomeAirport(history)).toBe('BER');
    });

    it('returns null when no entry is open', () => {
      const history = [{ iata: 'MUC', fromDate: '2018-01-01', toDate: '2024-06-01' }];
      expect(getCurrentHomeAirport(history)).toBeNull();
    });
  });

  describe('applyHomeAirportMove', () => {
    it('closes the current entry and opens a new one on move', () => {
      const before = [{ iata: 'MUC', fromDate: '2018-01-01', toDate: null }];
      const after = applyHomeAirportMove(before, 'BER', '2024-06-01');
      expect(after).toHaveLength(2);
      expect(after[0]).toEqual({ iata: 'MUC', fromDate: '2018-01-01', toDate: '2024-06-01' });
      expect(after[1]).toEqual({ iata: 'BER', fromDate: '2024-06-01', toDate: null });
    });

    it('is idempotent when moving to the same airport that is already active', () => {
      const before = [{ iata: 'MUC', fromDate: '2018-01-01', toDate: null }];
      const after = applyHomeAirportMove(before, 'MUC', '2024-06-01');
      expect(after).toEqual(before);
    });

    it('creates a first entry when history was empty', () => {
      const after = applyHomeAirportMove([], 'MUC', '2018-01-01');
      expect(after).toEqual([{ iata: 'MUC', fromDate: '2018-01-01', toDate: null }]);
    });

    it('normalizes the new IATA to uppercase', () => {
      const after = applyHomeAirportMove([], 'muc', '2018-01-01');
      expect(after[0].iata).toBe('MUC');
    });
  });

  describe('normalizeHistory', () => {
    it('drops entries with missing fields and sorts the rest', () => {
      const raw = [
        { iata: 'BER', fromDate: '2024-06-01', toDate: null },
        { iata: 'MUC', fromDate: '2018-01-01', toDate: '2024-06-01' },
        { iata: 'BAD' }, // invalid — dropped
        {}, // invalid — dropped
      ];
      const result = normalizeHistory(raw);
      expect(result).toHaveLength(2);
      expect(result[0].iata).toBe('MUC');
      expect(result[1].iata).toBe('BER');
    });

    it('returns empty array on non-array input', () => {
      expect(normalizeHistory(null)).toEqual([]);
      expect(normalizeHistory('not an array')).toEqual([]);
    });
  });

  describe('sortHistory', () => {
    it('orders entries chronologically', () => {
      const input = [
        { iata: 'BER', fromDate: '2024-06-01', toDate: null },
        { iata: 'MUC', fromDate: '2018-01-01', toDate: '2024-06-01' },
      ];
      const sorted = sortHistory(input);
      expect(sorted[0].iata).toBe('MUC');
      expect(sorted[1].iata).toBe('BER');
    });
  });
});
