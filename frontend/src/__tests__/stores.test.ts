import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { useToastStore } from '../store/toastStore';
import type { User } from '../types';

// Mock API
vi.mock('../lib/api', () => ({
  authApi: {
    logout: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('Zustand Stores', () => {
  describe('AuthStore', () => {
    beforeEach(() => {
      // Reset store before each test
      useAuthStore.setState({ user: null });
    });

    it('should initialize with null user', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current.user).toBeNull();
    });

    it('should set user on login', () => {
      const { result } = renderHook(() => useAuthStore());
      const mockUser: User = {
        id: 'test-user-id',
        email: 'test@example.com',
        username: 'testuser',
        isAdmin: false,
        createdAt: new Date().toISOString(),
      };

      act(() => {
        result.current.setAuth(mockUser);
      });

      expect(result.current.user).toEqual(mockUser);
    });

    it('should clear user on logout', async () => {
      const { result } = renderHook(() => useAuthStore());
      const mockUser: User = {
        id: 'test-user-id',
        email: 'test@example.com',
        username: 'testuser',
        isAdmin: false,
        createdAt: new Date().toISOString(),
      };

      act(() => {
        result.current.setAuth(mockUser);
      });

      expect(result.current.user).toEqual(mockUser);

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
    });

    it('should clear user on logout even if API fails', async () => {
      const { authApi } = await import('../lib/api');
      const mockLogout = authApi.logout as any;
      mockLogout.mockRejectedValueOnce(new Error('API error'));

      const { result } = renderHook(() => useAuthStore());
      const mockUser: User = {
        id: 'test-user-id',
        email: 'test@example.com',
        username: 'testuser',
        isAdmin: false,
        createdAt: new Date().toISOString(),
      };

      act(() => {
        result.current.setAuth(mockUser);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
    });
  });

  describe('ThemeStore', () => {
    beforeEach(() => {
      // Reset store and localStorage
      useThemeStore.setState({ isDarkMode: false });
      localStorage.clear();
      document.documentElement.classList.remove('dark');
    });

    it('should initialize with light mode by default', () => {
      const { result } = renderHook(() => useThemeStore());

      expect(result.current.isDarkMode).toBe(false);
    });

    it('should toggle dark mode', () => {
      const { result } = renderHook(() => useThemeStore());

      expect(result.current.isDarkMode).toBe(false);

      act(() => {
        result.current.toggleDarkMode();
      });

      expect(result.current.isDarkMode).toBe(true);

      act(() => {
        result.current.toggleDarkMode();
      });

      expect(result.current.isDarkMode).toBe(false);
    });

    it('should set dark mode explicitly', () => {
      const { result } = renderHook(() => useThemeStore());

      act(() => {
        result.current.setDarkMode(true);
      });

      expect(result.current.isDarkMode).toBe(true);

      act(() => {
        result.current.setDarkMode(false);
      });

      expect(result.current.isDarkMode).toBe(false);
    });

    it('should add dark class to document when dark mode is enabled', () => {
      const { result } = renderHook(() => useThemeStore());

      act(() => {
        result.current.setDarkMode(true);
      });

      expect(document.documentElement.classList.contains('dark')).toBe(true);

      act(() => {
        result.current.setDarkMode(false);
      });

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('ToastStore', () => {
    beforeEach(() => {
      useToastStore.setState({ toasts: [] });
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should initialize with empty toasts array', () => {
      const { result } = renderHook(() => useToastStore());

      expect(result.current.toasts).toEqual([]);
    });

    it('should add toast', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast('success', 'Test message');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].type).toBe('success');
      expect(result.current.toasts[0].message).toBe('Test message');
      expect(result.current.toasts[0].id).toBeDefined();
    });

    it('should add multiple toasts', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast('success', 'Message 1');
        result.current.addToast('error', 'Message 2');
        result.current.addToast('warning', 'Message 3');
      });

      expect(result.current.toasts).toHaveLength(3);
      expect(result.current.toasts[0].message).toBe('Message 1');
      expect(result.current.toasts[1].message).toBe('Message 2');
      expect(result.current.toasts[2].message).toBe('Message 3');
    });

    it('should remove specific toast', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast('success', 'Message 1');
        result.current.addToast('error', 'Message 2');
      });

      const firstToastId = result.current.toasts[0].id;

      act(() => {
        result.current.removeToast(firstToastId);
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Message 2');
    });

    it('should clear all toasts', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast('success', 'Message 1');
        result.current.addToast('error', 'Message 2');
        result.current.addToast('warning', 'Message 3');
      });

      expect(result.current.toasts).toHaveLength(3);

      act(() => {
        result.current.clearToasts();
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should auto-remove toast after duration', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast('success', 'Test message', 3000);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should use default duration of 5000ms', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast('success', 'Test message');
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(4999);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should support different toast types', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast('success', 'Success message');
        result.current.addToast('error', 'Error message');
        result.current.addToast('warning', 'Warning message');
        result.current.addToast('info', 'Info message');
      });

      expect(result.current.toasts).toHaveLength(4);
      expect(result.current.toasts[0].type).toBe('success');
      expect(result.current.toasts[1].type).toBe('error');
      expect(result.current.toasts[2].type).toBe('warning');
      expect(result.current.toasts[3].type).toBe('info');
    });

    it('should not auto-remove toast with duration 0', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast('success', 'Persistent message', 0);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(result.current.toasts).toHaveLength(1);
    });
  });
});
