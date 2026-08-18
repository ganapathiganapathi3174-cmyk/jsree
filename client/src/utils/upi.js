import { ADMIN_UPI } from './constants';

export const PAYEE_NAME = 'JSREE';

export function buildUPIURI({ upiId, amount, payeeName = PAYEE_NAME, note, txnRef }) {
  const parts = [];
  const push = (key, value) => {
    if (value !== undefined && value !== null && value !== '') parts.push(`${key}=${encodeURIComponent(String(value))}`);
  };
  push('pa', upiId || ADMIN_UPI);
  push('pn', payeeName);
  const amt = Number(amount);
  if (Number.isFinite(amt) && amt > 0) push('am', String(Math.round(amt)));
  push('cu', 'INR');
  push('tn', note);
  push('tr', txnRef);
  return `upi://pay?${parts.join('&')}`;
}