import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RegisterPage from './RegisterPage';
import PaymentStatusPage from './PaymentStatusPage';

const post = vi.fn();
const get = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastMessage = vi.fn();
const SYNTHETIC_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);

vi.mock('../utils/api', () => ({
  default: { post: (...args) => post(...args), get: (...args) => get(...args) },
  isTimeoutError: () => false,
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign((...args) => toastMessage(...args), {
    error: (...args) => toastError(...args),
    success: (...args) => toastSuccess(...args),
  }),
}));

const payment = {
  id: 'synthetic-payment-1',
  expected_amount: 120,
  selected_plan: 120,
  submitted_at: '2026-10-19T07:30:00.000Z',
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
};

describe('registration screenshot upload payment-status flow', () => {
  let paymentRecord;
  let statusAfterScreenshotStored;
  let verificationResponseStatus;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    paymentRecord = { ...payment, status: 'pending', screenshot_url: null };
    statusAfterScreenshotStored = null;
    verificationResponseStatus = null;
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: () => 'blob:synthetic-payment-proof',
      revokeObjectURL: () => {},
    }));

    post.mockImplementation(async (url) => {
      if (url === '/auth/register') {
        return {
          data: {
            data: {
              token: 'synthetic-user-token',
              user: { id: 'synthetic-user-1', role: 'user', status: 'pending' },
            },
          },
        };
      }
      if (url === '/payments') return { data: { data: payment } };
      if (url === `/payments/${payment.id}/screenshot`) {
        paymentRecord.screenshot_url = 'https://mock-storage.invalid/synthetic.png';
        statusAfterScreenshotStored = paymentRecord.status;
        paymentRecord.status = 'manual_review';
        verificationResponseStatus = 'manual_review';
        return {
          data: {
            data: {
              verification: {
                status: 'manual_review',
                reason: 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED',
              },
            },
          },
        };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    get.mockImplementation(async (url) => {
      if (url === '/config/public') return { data: { data: {} } };
      if (url === '/payments') {
        return {
          data: {
            data: [{
              ...paymentRecord,
              status: paymentRecord.status === 'manual_review' ? 'pending' : paymentRecord.status,
            }],
          },
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps an OCR-only screenshot in review and shows it as pending on the status page', async () => {
    render(
      <MemoryRouter initialEntries={['/register?plan=120']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/payment-status" element={<PaymentStatusPage />} />
          <Route path="/dashboard" element={<h1>Dashboard</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'Synthetic QA User' } });
    fireEvent.change(screen.getByPlaceholderText('john@example.com'), { target: { value: 'synthetic@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('9876543210'), { target: { value: '9000000001' } });
    fireEvent.change(screen.getByPlaceholderText('Min 6 characters'), { target: { value: 'SyntheticPass123' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'SyntheticPass123' } });
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Basic/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Next/ }).at(-1));

    await screen.findByText('Complete Payment');
    expect(paymentRecord.status).toBe('pending');

    const syntheticImage = new File([SYNTHETIC_PNG], 'synthetic.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [syntheticImage] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Verify Payment & Continue/ }));

    await screen.findByRole('heading', { name: 'Account Activation' });
    expect(post).toHaveBeenCalledWith(
      `/payments/${payment.id}/screenshot`,
      expect.any(FormData),
    );
    expect(post.mock.calls.at(-1)[1].get('screenshot')).toBe(syntheticImage);
    expect(statusAfterScreenshotStored).toBe('pending');
    expect(verificationResponseStatus).toBe('manual_review');
    expect(paymentRecord.status).toBe('manual_review');
    expect(await screen.findByText('Pending')).toBeTruthy();
    expect(screen.getByText('Verifying your payment')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull();
    expect(toastMessage).toHaveBeenCalledWith(
      'Your payment is being reviewed by our team. We will notify you once it is verified.',
      { icon: '⏳' },
    );
    expect(get).toHaveBeenCalledWith('/payments');
  });
});
