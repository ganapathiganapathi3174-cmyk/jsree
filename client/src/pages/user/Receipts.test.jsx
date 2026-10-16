import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Receipts from './Receipts';

const get = vi.fn();
const toastError = vi.fn();

vi.mock('../../utils/api', () => ({
  default: { get: (...a) => get(...a) }
}));

vi.mock('react-hot-toast', () => ({
  default: { error: (...a) => toastError(...a) }
}));

const RECEIPTS = {
  receipts: [{
    paymentId: 'pay-1',
    receiptId: 'RCT-0001',
    createdAt: '2026-01-05T10:00:00.000Z',
    amount: 120,
    planMonths: 1
  }],
  pagination: { page: 1, totalPages: 1 }
};

describe('Receipts', () => {
  beforeEach(() => {
    get.mockReset();
    toastError.mockReset();
    get.mockResolvedValue({ data: RECEIPTS });

    // jsdom has no object-URL support and window.open would navigate away.
    URL.createObjectURL = vi.fn(() => 'blob:mock-receipt');
    URL.revokeObjectURL = vi.fn();
    window.open = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the receipt returned by the API', async () => {
    render(<Receipts />);
    expect(await screen.findByText('RCT-0001')).toBeTruthy();
    expect(screen.getByText('₹120')).toBeTruthy();
  });

  // Regression: the View button used window.open('/api/receipts/<id>/html'),
  // which drops the axios baseURL (VITE_API_URL) and cannot send the
  // Authorization header the endpoint requires.
  it('fetches the receipt HTML through the shared api instance', async () => {
    render(<Receipts />);
    fireEvent.click(await screen.findByRole('button', { name: /View/ }));

    await waitFor(() => expect(get).toHaveBeenCalledWith(
      '/receipts/pay-1/html',
      { responseType: 'text' }
    ));
    expect(window.open).toHaveBeenCalledWith('blob:mock-receipt', '_blank');
    expect(window.open).not.toHaveBeenCalledWith('/api/receipts/pay-1/html', expect.anything());
  });

  it('shows an error toast and opens nothing when the fetch fails', async () => {
    get
      .mockResolvedValueOnce({ data: RECEIPTS })   // initial list load
      .mockRejectedValueOnce(new Error('401'));    // receipt HTML fetch
    render(<Receipts />);
    fireEvent.click(await screen.findByRole('button', { name: /View/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to load receipt'));
    expect(window.open).not.toHaveBeenCalled();
  });

  it('revokes the object URL after the tab is opened', async () => {
    vi.useFakeTimers();
    try {
      render(<Receipts />);
      // The initial fetch is a resolved promise, so draining microtasks is
      // enough to render the table without relying on waitFor's timers.
      await act(async () => { await Promise.resolve(); });
      fireEvent.click(screen.getByRole('button', { name: /View/ }));
      await act(async () => { await Promise.resolve(); });

      expect(window.open).toHaveBeenCalled();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();

      vi.advanceTimersByTime(60001);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-receipt');
    } finally {
      vi.useRealTimers();
    }
  });
});
