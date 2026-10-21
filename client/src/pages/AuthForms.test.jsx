import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RegisterPage from './RegisterPage';
import LoginPage from './LoginPage';
import AdminLoginPage from './AdminLoginPage';

function renderPage(Page) {
  return render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>
  );
}

describe('authentication form accessibility', () => {
  it('associates visible labels with every registration field', () => {
    renderPage(RegisterPage);

    for (const label of [
      'Full Name',
      'Email',
      'Mobile',
      'Password',
      'Confirm Password',
      'Referral Code (optional)'
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('associates visible labels with login fields', () => {
    renderPage(LoginPage);

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('associates visible labels with admin login fields', () => {
    renderPage(AdminLoginPage);

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('keeps the password visibility toggle keyboard reachable', () => {
    renderPage(LoginPage);

    expect(screen.getByRole('button', { name: 'Show password' }).tabIndex).toBe(0);
  });
});
