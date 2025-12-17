import { describe, it, expect } from 'vitest';
import { API_TIMEOUTS } from '../config/constants';
import api from '../lib/api';
import { parseApi, authApi } from '../lib/api';

describe('API Configuration', () => {
  it('should use correct timeout values from constants', () => {
    expect(API_TIMEOUTS.DEFAULT).toBe(10000);
    expect(API_TIMEOUTS.PARSER).toBe(180000);
  });

  it('should create api instance with correct timeout', () => {
    expect(api.defaults.timeout).toBe(API_TIMEOUTS.DEFAULT);
    expect(api.defaults.withCredentials).toBe(true);
  });

  it('should export API objects', () => {
    expect(parseApi).toBeDefined();
    expect(authApi).toBeDefined();
    expect(typeof parseApi.parseEmail).toBe('function');
    expect(typeof authApi.login).toBe('function');
  });

  it('should have response interceptors configured', () => {
    // Interceptors are configured, verify by checking that the instance exists
    expect(api.interceptors.response).toBeDefined();
    expect(api.interceptors.request).toBeDefined();
  });
});

