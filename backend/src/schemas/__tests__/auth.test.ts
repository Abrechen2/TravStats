import { describe, it, expect } from '@jest/globals';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  forceChangePasswordSchema,
  adminResetPasswordSchema,
} from '../auth';

describe('forgotPasswordSchema', () => {
  it('accepts a valid username', () => {
    const result = forgotPasswordSchema.parse({ username: 'alice' });
    expect(result.username).toBe('alice');
  });

  it('rejects empty username', () => {
    expect(() => forgotPasswordSchema.parse({ username: '' })).toThrow();
  });
});

describe('resetPasswordSchema', () => {
  it('accepts valid token and password', () => {
    const result = resetPasswordSchema.parse({ token: 'abc', newPassword: 'password1' });
    expect(result.newPassword).toBe('password1');
  });

  it('rejects password shorter than 8 chars', () => {
    expect(() => resetPasswordSchema.parse({ token: 'abc', newPassword: 'short' })).toThrow();
  });
});

describe('forceChangePasswordSchema', () => {
  it('accepts valid changeToken and password', () => {
    const result = forceChangePasswordSchema.parse({ changeToken: 'tok', newPassword: 'newpass1' });
    expect(result.changeToken).toBe('tok');
  });

  it('accepts without changeToken (delivered via cookie)', () => {
    const result = forceChangePasswordSchema.parse({ newPassword: 'newpass1' });
    expect(result.changeToken).toBeUndefined();
  });
});

describe('adminResetPasswordSchema', () => {
  it('accepts mode generate', () => {
    const r = adminResetPasswordSchema.parse({ mode: 'generate' });
    expect(r.mode).toBe('generate');
  });

  it('accepts mode set with password', () => {
    const r = adminResetPasswordSchema.parse({ mode: 'set', password: 'newpass12' });
    expect(r.password).toBe('newpass12');
  });

  it('rejects unknown mode', () => {
    expect(() => adminResetPasswordSchema.parse({ mode: 'delete' })).toThrow();
  });
});
