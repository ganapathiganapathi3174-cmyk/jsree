import { useState, useEffect, useMemo } from 'react';
import { Copy, ScanLine, Smartphone, Upload, CheckCircle2, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import QRCodeImage from './QRCodeImage';
import { ADMIN_UPI } from '../utils/constants';
import { buildUPIURI, PAYEE_NAME } from '../utils/upi';
import { formatCurrency } from '../utils/helpers';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;
const QR_SIZE = 240;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia('(max-width: 767px)') : null;
    const update = () => setIsMobile(mq ? mq.matches : /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
    update();
    if (mq) {
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', update);
      else if (typeof mq.addListener === 'function') mq.addListener(update);
    }
    return () => {
      if (mq) {
        if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', update);
        else if (typeof mq.removeListener === 'function') mq.removeListener(update);
      }
    };
  }, []);
  return isMobile;
}

export default function QRPaymentSection({
  amount,
  onAmountChange,
  amountOptions = [120, 500, 1000],
  upiId = ADMIN_UPI,
  recipientName = PAYEE_NAME,
  verifyLabel = 'Verify Payment',
  verifySubmitting = false,
  disabled = false,
  onVerify,
}) {
  const isMobile = useIsMobile();
  const [screenshot, setScreenshot] = useState(null);
  const [preview, setPreview] = useState(null);

  const validAmount = Number(amount) > 0 && amountOptions.includes(Number(amount));
  const upiUri = useMemo(
    () => buildUPIURI({ upiId, amount, payeeName: recipientName, note: `${recipientName} payment` }),
    [upiId, amount, recipientName]
  );

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) { toast.error('Only JPG, PNG, WEBP allowed'); return; }
    if (file.size > MAX_SIZE) { toast.error('Max file size is 5MB'); return; }
    setScreenshot(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
  };

  const handleVerify = () => {
    if (!screenshot) { toast.error('Please upload payment screenshot first'); return; }
    if (typeof onVerify === 'function') onVerify(screenshot);
  };

  const copyUPI = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(upiId);
    toast.success('UPI ID copied!');
  };

  return (
    <div className="space-y-4">
      {onAmountChange && (
        <div>
          <label className="label">Select Amount</label>
          <div className="grid grid-cols-3 gap-3">
            {amountOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onAmountChange(opt)}
                className={`rounded-xl border-2 py-3 text-center transition-all ${Number(amount) === Number(opt) ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <span className={`text-lg font-bold ${Number(amount) === Number(opt) ? 'text-primary-700' : 'text-gray-900'}`}>₹{opt}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-primary-200 bg-white p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-wide text-gray-900">JSREE</span>
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">UPI</span>
          </div>
          <span className="text-xs text-gray-500">Secure UPI Payment</span>
        </div>

        <p className="text-sm text-gray-500">Payment Amount</p>
        <p className="text-3xl font-bold text-gray-900">Pay {formatCurrency(amount || 0)}</p>

        <div className="mt-5 text-center">
          <p className="flex items-center justify-center gap-2 font-semibold text-gray-900">
            <ScanLine className="h-4 w-4 text-primary-600" /> Scan &amp; Pay
          </p>
          <p className="text-sm text-gray-600 mt-1">Scan this QR with any UPI app (GPay, PhonePe, Paytm &amp; more)</p>

          <div className="mt-3 inline-block rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <QRCodeImage value={upiUri} size={QR_SIZE} className="w-full max-w-[240px] h-auto" />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Amount {formatCurrency(amount || 0)} is pre-filled. Verify the recipient before you pay.
          </p>

          {isMobile && (
            <a
              href={upiUri}
              className="btn-secondary mt-3 w-full sm:w-auto py-2.5 px-6 text-base flex items-center justify-center gap-2"
            >
              <Smartphone className="h-4 w-4" /> Pay with UPI App
            </a>
          )}

          <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-left">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">UPI ID</p>
              <p className="font-mono text-sm font-semibold text-gray-900 truncate">{upiId}</p>
            </div>
            <button type="button" onClick={copyUPI} className="text-primary-600 hover:text-primary-700 shrink-0" aria-label="Copy UPI ID">
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!validAmount && (
          <p className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
            Select a valid payment amount to generate the QR.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <CheckCircle2 className="h-4 w-4 text-green-600" /> Payment completed?
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Completed the payment in your UPI app? Upload the payment screenshot below and it will be verified.
        </p>

        <div className="mt-3">
          <label className="label">Upload Payment Screenshot</label>
          <label className="block border-2 border-dashed border-gray-300 rounded-xl p-5 text-center cursor-pointer hover:border-primary-400 transition-colors">
            {preview ? (
              <img src={preview} alt="Payment screenshot preview" className="max-h-48 mx-auto rounded-lg" />
            ) : (
              <div>
                <Upload className="h-10 w-10 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Click to upload JPG, PNG, WEBP</p>
              </div>
            )}
            <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" onChange={handleFile} />
          </label>
          <p className="text-xs text-gray-400 mt-1">Accepted formats: JPG, PNG, WEBP · max 5MB</p>
        </div>

        <button
          type="button"
          onClick={handleVerify}
          disabled={verifySubmitting || !screenshot}
          className="btn-primary mt-4 w-full py-3 text-base flex items-center justify-center gap-2"
        >
          <ShieldCheck className="h-4 w-4" /> {verifySubmitting ? 'Verifying...' : verifyLabel}
        </button>
      </div>
    </div>
  );
}