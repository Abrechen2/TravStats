import { describe, it, expect } from '@jest/globals';
import { serializeBigInt } from '../utils/serializeBigInt';

describe('serializeBigInt', () => {
  it('converts top-level BigInt to string', () => {
    expect(serializeBigInt(123n)).toBe('123');
  });

  it('converts nested BigInt values to strings', () => {
    const input = { id: 1, size: 9007199254740993n };
    const out = serializeBigInt(input);
    expect(out).toEqual({ id: 1, size: '9007199254740993' });
  });

  it('passes primitives through unchanged', () => {
    expect(serializeBigInt(null)).toBeNull();
    expect(serializeBigInt(undefined)).toBeUndefined();
    expect(serializeBigInt(42)).toBe(42);
    expect(serializeBigInt('hello')).toBe('hello');
    expect(serializeBigInt(true)).toBe(true);
  });

  it('preserves Date instances unchanged (regression: was serialized to {})', () => {
    const d = new Date('2026-04-11T12:00:00.000Z');
    const result = serializeBigInt(d);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(d.getTime());
  });

  it('preserves Date fields inside objects', () => {
    const input = {
      id: 'backup-1',
      status: 'completed',
      size: 12345n,
      startedAt: new Date('2026-04-11T12:00:00.000Z'),
      completedAt: new Date('2026-04-11T12:01:00.000Z'),
    };
    const out = serializeBigInt(input);
    expect(out.id).toBe('backup-1');
    expect(out.size).toBe('12345');
    expect(out.startedAt).toBeInstanceOf(Date);
    expect(out.completedAt).toBeInstanceOf(Date);
    expect(out.startedAt.toISOString()).toBe('2026-04-11T12:00:00.000Z');
  });

  it('handles arrays with mixed types', () => {
    const input = [
      { size: 100n, startedAt: new Date('2026-04-11T12:00:00.000Z') },
      { size: 200n, startedAt: new Date('2026-04-11T13:00:00.000Z') },
    ];
    const out = serializeBigInt(input);
    expect(out[0].size).toBe('100');
    expect(out[0].startedAt).toBeInstanceOf(Date);
    expect(out[1].size).toBe('200');
    expect(out[1].startedAt).toBeInstanceOf(Date);
  });

  it('serializes cleanly through JSON.stringify (end-to-end wire format)', () => {
    const input = {
      size: 42n,
      completedAt: new Date('2026-04-11T12:00:00.000Z'),
    };
    const json = JSON.stringify(serializeBigInt(input));
    const parsed = JSON.parse(json);
    expect(parsed.size).toBe('42');
    expect(parsed.completedAt).toBe('2026-04-11T12:00:00.000Z');
  });
});
