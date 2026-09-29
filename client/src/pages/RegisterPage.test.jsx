import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RegisterPage from './RegisterPage';

const post = vi.fn();
const get = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('../utils/api', () => ({
  default: { post: (...a) => post(...a), get: (...a) => get(...a) },
  isTimeoutError: (e) => e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || e?.code === 'ERR_CANCELED'
}));

vi.mock('react-hot-toast', () => ({
  default: { error: (...a) => toastError(...a), success: (...a) => toastSuccess(...a) }
}));

const PAYMENT = { id: 'pay-123', expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() };

const setField = (placeholder, value) => {
  const el = document.querySelector(`input[placeholder='${placeholder}']`);
  fireEvent.change(el, { target: { value } });
};

async function reachPaymentStep() {
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>
  );
  setField('John Doe', 'QA User');
  setField('9876543210', '9876543210');
  document.querySelector("input[type='email']").focus();
  fireEvent.change(document.querySelector("input[type='email']"), { target: { value: 'qa@example.com' } });
  fireEvent.change(document.querySelector("input[placeholder='Min 6 characters']"), { target: { value: 'Test@123456' } });
  fireEvent.change(document.querySelector("input[placeholder='Re-enter password']"), { target: { value: 'Test@123456' } });

  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  await waitFor(() => expect(screen.getByText('Select Plan')).toBeTruthy());

  fireEvent.click(screen.getByRole('button', { name: /Basic/ }));
  fireEvent.click(screen.getAllByRole('button', { name: /^Next/ }).pop());
  await waitFor(() => expect(screen.getByText('Complete Payment')).toBeTruthy());
}

function uploadScreenshot() {
  const file = new File(['binary'], 'gpay.png', { type: 'image/png' });
  fireEvent.change(document.querySelector("input[type='file']"), { target: { files: [file] } });
  return file;
}

const verifyButton = () => screen.getByRole('button', { name: /Verify Payment|Verifying/ });

describe('RegisterPage payment verification — loading always resets', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => {}
    }));
    post.mockImplementation((url) => {
      if (url === '/auth/register') return Promise.resolve({ data: { data: { token: 't', user: { id: 'u1' } } } });
      if (url === '/payments') return Promise.resolve({ data: { data: PAYMENT } });
      return Promise.resolve({ data: { data: { verification: { status: 'pending' } } } });
    });
    get.mockResolvedValue({ data: { data: {} } });
    localStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('calls the screenshot API with the created payment id', async () => {
    await reachPaymentStep();
    const file = uploadScreenshot();
    fireEvent.click(verifyButton());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payments/pay-123/screenshot', expect.any(FormData)));
    expect(post.mock.calls.at(-1)[1].get('screenshot')).toBe(file);
  });

  it('resets the button when the request times out (stuck "Verifying..." regression)', async () => {
    await reachPaymentStep();
    uploadScreenshot();
    post.mockImplementation((url) => {
      if (url === '/auth/register') return Promise.resolve({ data: { data: { token: 't', user: { id: 'u1' } } } });
      if (url === '/payments') return Promise.resolve({ data: { data: PAYMENT } });
      return Promise.reject(Object.assign(new Error('timeout of 120000ms exceeded'), { code: 'ECONNABORTED' }));
    });

    fireEvent.click(verifyButton());
    await waitFor(() => expect(verifyButton().textContent).toContain('Verifying'));

    await waitFor(() => expect(verifyButton().textContent).toContain('Verify Payment & Continue'), { timeout: 2000 });
    expect(toastError).toHaveBeenCalledWith('Verification is taking too long. Please check your connection and try again.');
  });

  it('resets the button when the API rejects', async () => {
    await reachPaymentStep();
    uploadScreenshot();
    post.mockImplementation((url) => {
      if (url === '/auth/register') return Promise.resolve({ data: { data: { token: 't', user: { id: 'u1' } } } });
      if (url === '/payments') return Promise.resolve({ data: { data: PAYMENT } });
      return Promise.reject({ response: { data: { message: 'Upload failed' } } });
    });

    fireEvent.click(verifyButton());
    await waitFor(() => expect(verifyButton().textContent).toContain('Verify Payment & Continue'), { timeout: 2000 });
    expect(toastError).toHaveBeenCalledWith('Upload failed');
  });

  it('resets the button when a non-payment error is thrown mid-flow', async () => {
    await reachPaymentStep();
    uploadScreenshot();
    post.mockImplementation((url) => {
      if (url === '/auth/register') return Promise.resolve({ data: { data: { token: 't', user: { id: 'u1' } } } });
      if (url === '/payments') return Promise.resolve({ data: { data: PAYMENT } });
      return Promise.reject({ response: { data: { code: 'PAYMENT_EXPIRED' } } });
    });

    fireEvent.click(verifyButton());
    await waitFor(() => expect(screen.getByText('Setting up payment request...')).toBeTruthy(), { timeout: 2000 });
    expect(post).toHaveBeenCalledTimes(3);
  });
});
