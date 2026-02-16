import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import RegisterPage from '../pages/RegisterPage';
import { useAuthStore } from '../store/authStore';

vi.mock('../lib/api');
vi.mock('../store/authStore');

const mockUseAuthStore = vi.mocked(useAuthStore);

describe('RegisterPage', () => {
  const mockSetAuth = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue({
      setAuth: mockSetAuth,
    } as ReturnType<typeof useAuthStore>);
  });

  it('should render registration form', () => {
    render(
      <BrowserRouter>
        <RegisterPage />
      </BrowserRouter>
    );

    // Labels use i18n keys: register.username, register.password, register.confirmPassword
    expect(screen.getByLabelText(/register\.username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/register\.password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/register\.confirmPassword/i)).toBeInTheDocument();
  });

  it('should validate password mismatch', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BrowserRouter>
        <RegisterPage />
      </BrowserRouter>
    );

    const passwordInput = screen.getByLabelText(/register\.password$/i);
    const confirmPasswordInput = screen.getByLabelText(/register\.confirmPassword/i);
    const form = container.querySelector('form');

    await user.type(passwordInput, 'password123');
    await user.type(confirmPasswordInput, 'password456');

    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(() => {
      // Error text is the i18n key: register.passwordsNotMatch
      expect(screen.getByText(/register\.passwordsNotMatch/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should validate minimum password length', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BrowserRouter>
        <RegisterPage />
      </BrowserRouter>
    );

    const passwordInput = screen.getByLabelText(/register\.password$/i);
    const confirmPasswordInput = screen.getByLabelText(/register\.confirmPassword/i);
    const form = container.querySelector('form');

    await user.type(passwordInput, '12345');
    await user.type(confirmPasswordInput, '12345');

    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(() => {
      // Error text is the i18n key: register.passwordTooShort
      expect(screen.getByText(/register\.passwordTooShort/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
