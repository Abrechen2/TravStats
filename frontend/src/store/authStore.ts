import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { authApi } from '../lib/api';

interface AuthState {
  user: User | null;
  setAuth: (user: User) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setAuth: (user) => {
        // JWT is now stored in HttpOnly cookie (more secure)
        set({ user });
      },
      logout: async () => {
        try {
          // Clear the HttpOnly cookie on server
          await authApi.logout();
        } catch (error) {
          console.error('Logout error:', error);
        } finally {
          // Clear local user state regardless of API result
          set({ user: null });
        }
      },
    }),
    {
      name: 'auth-storage',
      // Only persist user data, not token (token is in HttpOnly cookie)
      partialize: (state) => ({ user: state.user }),
    }
  )
);
