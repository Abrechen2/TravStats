/**
 * Unit tests for the diagnostic-export PII scrubber. No DB or filesystem.
 */

import { __test } from '../services/diagnosticExport';

const { scrub, hashPrefix } = __test;

describe('diagnosticExport scrubber', () => {
  it('removes sensitive keys at every nesting level', () => {
    const input = {
      ip: '1.2.3.4',
      message: 'ok',
      context: {
        email: 'user@example.com',
        token: 'abc',
        nested: { cookie: 'x', meaningful: true },
      },
    };
    const out = scrub(input) as Record<string, unknown>;
    expect(out).not.toHaveProperty('ip');
    const ctx = out.context as Record<string, unknown>;
    expect(ctx).not.toHaveProperty('email');
    expect(ctx).not.toHaveProperty('token');
    const nested = ctx.nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty('cookie');
    expect(nested.meaningful).toBe(true);
    expect(out.message).toBe('ok');
  });

  it('redacts email addresses that appear inside string values', () => {
    const out = scrub({ note: 'see user alice@example.com for details' }) as {
      note: string;
    };
    expect(out.note).toContain('<redacted:email>');
    expect(out.note).not.toContain('alice@example.com');
  });

  it('redacts IPv4 addresses in string values', () => {
    const out = scrub({ note: 'connection from 192.168.1.45 refused' }) as { note: string };
    expect(out.note).toContain('<redacted:ip>');
    expect(out.note).not.toContain('192.168.1.45');
  });

  it('redacts JWT-shaped tokens in string values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJhYmMifQ.signature_part_base64urlsafe';
    const out = scrub({ note: `Bearer ${jwt}` }) as { note: string };
    expect(out.note).toContain('<redacted:jwt>');
    expect(out.note).not.toContain(jwt);
  });

  it('redacts UUIDs in string values', () => {
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const out = scrub({ note: `flight ${uuid} failed` }) as { note: string };
    expect(out.note).toContain('<redacted:uuid>');
    expect(out.note).not.toContain(uuid);
  });

  it('hashes userId into an opaque marker that is stable per user', () => {
    const a = scrub({ userId: 'user-123' }) as { userId: string };
    const b = scrub({ userId: 'user-123' }) as { userId: string };
    const c = scrub({ userId: 'user-999' }) as { userId: string };
    expect(a.userId).toMatch(/^<user:[0-9a-f]{1,6}>$/);
    expect(a.userId).toBe(b.userId);
    expect(a.userId).not.toBe(c.userId);
  });

  it('handles arrays recursively', () => {
    const out = scrub([{ email: 'a@b.de' }, { keep: 'me' }]) as Array<Record<string, unknown>>;
    expect(out[0]).not.toHaveProperty('email');
    expect(out[1].keep).toBe('me');
  });

  it('passes through primitives untouched', () => {
    expect(scrub(42)).toBe(42);
    expect(scrub(null)).toBe(null);
    expect(scrub(undefined)).toBe(undefined);
    expect(scrub(true)).toBe(true);
  });

  it('hashPrefix returns the same value for the same input', () => {
    expect(hashPrefix('user-alice-12345')).toBe(hashPrefix('user-alice-12345'));
    expect(hashPrefix('user-alice-12345')).not.toBe(hashPrefix('user-bob-67890'));
  });
});
