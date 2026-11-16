import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RegisterPage from './RegisterPage';
import { formatCurrency } from '../utils/helpers';
import { PLANS } from '../utils/constants';

const post = vi.fn();
const get = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('../utils/api', () => ({
  default: { post: (...a) => post(...a), get: (...a) => get(...a) },
  isTimeoutError: (e) => e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || e?.code === 'ERR_CANCELED',
}));

vi.mock('react-hot-toast', () => ({
  default: { error: (...a) => toastError(...a), success: (...a) => toastSuccess(...a) },
}));

const PAYMENT = { id: 'pay-123', expected_amount: 120, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() };

const REGISTER_OK = { data: { data: { token: 'fresh-token', user: { id: 'u1', role: 'user' } } } };

const httpError = (status, code, message, url) => Object.assign(new Error(message || code || 'error'), {
  config: { url },
  response: { status, config: { url }, data: { success: false, code, message } },
});

const setField = (placeholder, value) => {
  fireEvent.change(document.querySelector(`input[placeholder='${placeholder}']`), { target: { value } });
};

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<h1>Login Page</h1>} />
        <Route path="/payment-status" element={<h1>Payment Status Page</h1>} />
        <Route path="/dashboard" element={<h1>Dashboard Page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function reachPlanStep(planId = 120) {
  renderRegister();
  setField('John Doe', 'Repair QA User');
  setField('9876543210', '9000000001');
  fireEvent.change(document.querySelector("input[type='email']"), { target: { value: 'repair@example.test' } });
  fireEvent.change(document.querySelector("input[placeholder='Min 6 characters']"), { target: { value: 'RepairPass123' } });
  fireEvent.change(document.querySelector("input[placeholder='Re-enter password']"), { target: { value: 'RepairPass123' } });
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  await waitFor(() => expect(screen.getByText('Select Plan')).toBeTruthy());

  const plan = PLANS.find((p) => p.id === planId);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(plan.name) }));
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(plan.name) }).getAttribute('aria-pressed')).toBe('true'));
}

const nextButton = () => screen.getAllByRole('button', { name: /^Next/ }).at(-1);

const selectedPlanId = () => PLANS.find((p) => screen.getByRole('button', { name: new RegExp(p.name) }).getAttribute('aria-pressed') === 'true')?.id;

const noAutoRedirect = () => {
  expect(screen.queryByText('Login Page')).toBeNull();
  expect(screen.queryByText('Payment Status Page')).toBeNull();
  expect(screen.queryByText('Dashboard Page')).toBeNull();
};

// Step 2 has no text inputs, so "the form was preserved" is proven by going
// back to step 1 and reading the fields the user typed.
async function backToDetails() {
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  await waitFor(() => expect(screen.getByText('Personal Information')).toBeTruthy());
}

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  localStorage.clear();
  get.mockResolvedValue({ data: { data: {} } });
  post.mockImplementation(async (url) => {
    if (url === '/auth/register') return REGISTER_OK;
    if (url === '/payments') return { data: { data: PAYMENT } };
    throw new Error(`Unexpected POST ${url}`);
  });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
});

afterEach(() => vi.unstubAllGlobals());

describe('successful registration reaches the QR / screenshot upload step', () => {
  it('advances to step 3 with a populated payment and a usable upload input', async () => {
    await reachPlanStep(120);
    fireEvent.click(nextButton());

    await screen.findByText('Complete Payment');
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
    expect(localStorage.getItem('token')).toBe('fresh-token');
    expect(post).toHaveBeenCalledWith('/payments', { plan: '120' }, expect.anything());
    expect(toastError).not.toHaveBeenCalled();
  });

  it('sends the freshly stored Bearer token on the payment request', async () => {
    await reachPlanStep(120);
    fireEvent.click(nextButton());
    await screen.findByText('Complete Payment');

    const paymentCall = post.mock.calls.find((c) => c[0] === '/payments');
    expect(paymentCall[2].headers.Authorization).toBe('Bearer fresh-token');
  });

  for (const plan of PLANS) {
    it(`\u20B9${plan.id} plan reaches the QR screen showing ${formatCurrency(plan.id)}`, async () => {
      await reachPlanStep(plan.id);
      fireEvent.click(nextButton());

      await screen.findByText('Complete Payment');
      expect(post).toHaveBeenCalledWith('/payments', { plan: String(plan.id) }, expect.anything());
      expect(screen.getAllByText(formatCurrency(plan.id)).length).toBeGreaterThan(0);
      expect(document.querySelector('input[type="file"]')).toBeTruthy();
      expect(toastError).not.toHaveBeenCalled();
    });
  }
});

describe('duplicate identity is never auto-redirected to Login', () => {
  for (const [code, message] of [
    ['EMAIL_EXISTS', 'An account with this email already exists.'],
    ['MOBILE_EXISTS', 'A user with this mobile number already exists.'],
  ]) {
    it(`${code} shows the real server message, keeps the plan and offers an explicit login`, async () => {
      post.mockImplementation(async (url) => {
        if (url === '/auth/register') throw httpError(409, code, message, '/auth/register');
        throw new Error(`Unexpected POST ${url}`);
      });

      await reachPlanStep(500);
      fireEvent.click(nextButton());

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
      noAutoRedirect();
      expect(screen.getByRole('alert').textContent).toContain(message);
      expect(screen.getByText('Select Plan')).toBeTruthy();
      expect(selectedPlanId()).toBe(500);
      expect(post).toHaveBeenCalledTimes(1);

      await backToDetails();
      expect(document.querySelector("input[type='email']").value).toBe('repair@example.test');

      // Round-trip back to step 2: the plan and the recovery action survived.
      fireEvent.click(nextButton());
      await waitFor(() => expect(screen.getByText('Select Plan')).toBeTruthy());
      expect(selectedPlanId()).toBe(500);

      fireEvent.click(screen.getByRole('button', { name: 'Log in to continue' }));
      await screen.findByText('Login Page');
    });
  }
});

describe('payment conflicts are handled without duplicate requests', () => {
  it('PAYMENT_EXISTS shows the server message and preserves the plan', async () => {
    post.mockImplementation(async (url) => {
      if (url === '/auth/register') return REGISTER_OK;
      if (url === '/payments') throw httpError(409, 'PAYMENT_EXISTS', 'This account already has an approved payment.', '/payments');
      throw new Error(`Unexpected POST ${url}`);
    });

    await reachPlanStep(1000);
    fireEvent.click(nextButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This account already has an approved payment.'));
    noAutoRedirect();
    expect(screen.getByText('Select Plan')).toBeTruthy();
    expect(selectedPlanId()).toBe(1000);
    expect(post.mock.calls.filter((c) => c[0] === '/auth/register')).toHaveLength(1);
    expect(post.mock.calls.filter((c) => c[0] === '/payments')).toHaveLength(1);
  });

  it('PENDING_EXISTS offers the existing pending-payment flow instead of a second request', async () => {
    post.mockImplementation(async (url) => {
      if (url === '/auth/register') return REGISTER_OK;
      if (url === '/payments') throw httpError(409, 'PENDING_EXISTS', 'You already have a pending payment.', '/payments');
      throw new Error(`Unexpected POST ${url}`);
    });

    await reachPlanStep(500);
    fireEvent.click(nextButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('You already have a pending payment.'));
    noAutoRedirect();
    expect(screen.getByRole('alert').textContent).toContain('You already have a pending payment.');
    expect(selectedPlanId()).toBe(500);
    expect(post.mock.calls.filter((c) => c[0] === '/payments')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Continue existing payment' }));
    await screen.findByText('Payment Status Page');
  });
});

describe('session failures after registration never create a second account', () => {
  it('a 401 from the payment request does not repeat registration', async () => {
    post.mockImplementation(async (url) => {
      if (url === '/auth/register') return REGISTER_OK;
      if (url === '/payments') throw httpError(401, 'TOKEN_REQUIRED', 'Authentication token required', '/payments');
      throw new Error(`Unexpected POST ${url}`);
    });

    await reachPlanStep(120);
    fireEvent.click(nextButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    noAutoRedirect();
    expect(screen.getByText('Select Plan')).toBeTruthy();
    expect(selectedPlanId()).toBe(120);
    expect(post.mock.calls.filter((c) => c[0] === '/auth/register')).toHaveLength(1);
    expect(post.mock.calls.filter((c) => c[0] === '/payments')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('Your account was created');
    expect(localStorage.getItem('token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Log in to continue' }));
    await screen.findByText('Login Page');
  });

  it('a missing token after registration stops before payment and explains recovery', async () => {
    post.mockImplementation(async (url) => {
      if (url === '/auth/register') return { data: { data: { user: { id: 'u1' } } } };
      throw new Error(`Unexpected POST ${url}`);
    });

    await reachPlanStep(500);
    fireEvent.click(nextButton());

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    noAutoRedirect();
    expect(post.mock.calls.filter((c) => c[0] === '/payments')).toHaveLength(0);
    expect(selectedPlanId()).toBe(500);
    expect(screen.getByRole('alert').textContent).toContain('Your account was created');
    expect(localStorage.getItem('token')).toBeNull();
  });
});

describe('generic failures keep the form intact', () => {
  it('a 500 keeps the form, the plan and does not redirect to Login', async () => {
    post.mockImplementation(async (url) => {
      if (url === '/auth/register') throw httpError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.', '/auth/register');
      throw new Error(`Unexpected POST ${url}`);
    });

    await reachPlanStep(1000);
    fireEvent.click(nextButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Something went wrong on our side.'));
    noAutoRedirect();
    expect(screen.getByText('Select Plan')).toBeTruthy();
    expect(selectedPlanId()).toBe(1000);
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong on our side.');

    await backToDetails();
    expect(document.querySelector("input[type='email']").value).toBe('repair@example.test');
    expect(document.querySelector("input[placeholder='John Doe']").value).toBe('Repair QA User');
  });

  it('a network failure keeps the form and the plan', async () => {
    post.mockImplementation(async (url) => {
      if (url === '/auth/register') throw Object.assign(new Error('Network Error'), { request: {}, config: { url: '/auth/register' } });
      throw new Error(`Unexpected POST ${url}`);
    });

    await reachPlanStep(120);
    fireEvent.click(nextButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Network error. Please check your connection and try again.'));
    noAutoRedirect();
    expect(selectedPlanId()).toBe(120);
    expect(screen.getByRole('alert').textContent).toContain('could not reach the server');

    await backToDetails();
    expect(document.querySelector("input[type='email']").value).toBe('repair@example.test');
  });
});

describe('submission cannot be duplicated', () => {
  it('repeated Next clicks register and create a payment only once', async () => {
    let resolveRegister;
    post.mockImplementation((url) => {
      if (url === '/auth/register') {
        return new Promise((resolve) => { resolveRegister = () => resolve(REGISTER_OK); });
      }
      if (url === '/payments') return Promise.resolve({ data: { data: PAYMENT } });
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    await reachPlanStep(120);
    const button = nextButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(resolveRegister).toBeTruthy());
    resolveRegister();
    await screen.findByText('Complete Payment');

    expect(post.mock.calls.filter((c) => c[0] === '/auth/register')).toHaveLength(1);
    expect(post.mock.calls.filter((c) => c[0] === '/payments')).toHaveLength(1);
  });
});
