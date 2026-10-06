import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TopUps from './TopUps';

const get = vi.fn();
const post = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('../../utils/api', () => ({
  default: { get: (...a) => get(...a), post: (...a) => post(...a) }
}));

vi.mock('react-hot-toast', () => ({
  default: { error: (...a) => toastError(...a), success: (...a) => toastSuccess(...a) }
}));

const RECEIVED_TOPUP = {
  id: 't1',
  sender_id: 'u2',
  receiver_id: 'u1',
  amount: 120,
  status: 'completed',
  screenshot_url: 'https://x/s.png',
  created_at: new Date().toISOString()
};

const APPROVED = {
  data: { message: 'Topup approved and amount credited to your balance', data: { topupId: 't1', credited: true } }
};
const REJECTED = {
  data: { message: 'Topup rejected', data: { topupId: 't1', credited: false } }
};

function setFile() {
  const file = new File(['binary'], 'proof.png', { type: 'image/png' });
  fireEvent.change(document.querySelector("input[type='file']"), { target: { files: [file] } });
}

const verifyButton = () => screen.getByRole('button', { name: /Verify Payment/ });

describe('TopUps', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', current_plan: 120 }));
    get.mockResolvedValue({ data: { data: [RECEIVED_TOPUP], summary: null } });
    post.mockResolvedValue(APPROVED);
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => {}
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders exactly one Screenshot link per top-up row', async () => {
    render(<TopUps />);
    await waitFor(() => expect(screen.getAllByText('Screenshot')).toHaveLength(1));
  });

  it('reports an approved proof as a success toast', async () => {
    render(<TopUps />);
    await waitFor(() => expect(document.querySelector("input[type='file']")).toBeTruthy());
    setFile();
    fireEvent.click(verifyButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Topup approved and amount credited to your balance'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports a rejected proof as an error toast, not a success toast', async () => {
    post.mockResolvedValue(REJECTED);
    render(<TopUps />);
    await waitFor(() => expect(document.querySelector("input[type='file']")).toBeTruthy());
    setFile();
    fireEvent.click(verifyButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Topup rejected'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
