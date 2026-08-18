import { useMemo } from 'react';
import { Copy, Smartphone, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import QRCodeImage from './QRCodeImage';
import { buildUPIURI, PAYEE_NAME } from '../utils/upi';
import { formatCurrency } from '../utils/helpers';

export default function UPIPaymentModal({ isOpen, onClose, amount, upiId, recipientName = PAYEE_NAME }) {
  const uri = useMemo(
    () => buildUPIURI({ upiId, amount, payeeName: recipientName, note: `${recipientName} payment` }),
    [upiId, amount, recipientName]
  );

  const copyUPI = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(upiId);
    toast.success('UPI ID copied!');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Scan & Pay">
      <div className="flex flex-col items-center text-center">
        <div className="w-full max-w-[300px] rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-lg font-bold tracking-wide text-gray-900">JSREE</span>
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">UPI</span>
          </div>

          <div className="flex justify-center">
            <div className="w-full max-w-[240px]">
              <QRCodeImage value={uri} size={240} className="w-full h-auto" />
            </div>
          </div>

          <p className="mt-3 text-xl font-bold text-gray-900">
            {formatCurrency(amount || 0)}
          </p>
          <p className="mt-1 text-sm text-gray-600 font-medium">{recipientName}</p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span className="font-mono text-xs text-gray-500 break-all">{upiId}</span>
            <button
              type="button"
              onClick={copyUPI}
              className="text-primary-600 hover:text-primary-700"
              aria-label="Copy UPI ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <p className="mt-4 text-sm text-gray-700 font-medium">
          Scan this QR using any UPI app and complete the payment.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Amount of {formatCurrency(amount || 0)} is pre-filled. Verify the recipient before you pay.
        </p>

        <div className="mt-4 flex flex-col sm:flex-row items-stretch gap-2 w-full max-w-[300px]">
          <a
            href={uri}
            className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5"
          >
            <Smartphone className="h-4 w-4" /> Pay with UPI App
          </a>
          <button
            type="button"
            onClick={onClose}
            className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5"
          >
            <ShieldCheck className="h-4 w-4" /> I&apos;ve Paid
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Return to JSREE after paying, then upload your payment screenshot for verification.
        </p>
      </div>
    </Modal>
  );
}