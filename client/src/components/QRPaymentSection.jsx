import { useState, useEffect, useMemo, useRef } from 'react';
import { Copy, ScanLine, Smartphone, Upload, CheckCircle2, ShieldCheck, Clock, AlertTriangle, X, RefreshCw, LockKeyhole, BadgeCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import QRCodeImage from './QRCodeImage';
import { ADMIN_UPI } from '../utils/constants';
import { buildUPIURI, PAYEE_NAME } from '../utils/upi';
import { formatCurrency } from '../utils/helpers';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;
const QR_SIZE = 240;

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through to legacy copy */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

function useCountdown(expiresAt) {
  const [remaining, setRemaining] = useState(() => {
    if (!expiresAt) return null;
    const diff = new Date(expiresAt).getTime() - Date.now();
    return diff > 0 ? diff : 0;
  });

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      setRemaining(diff > 0 ? diff : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining === null) return { expired: false, minutes: null, seconds: null, totalSeconds: null, low: false };
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    expired: remaining <= 0,
    minutes,
    seconds,
    totalSeconds,
    low: totalSeconds > 0 && totalSeconds <= 5 * 60,
  };
}

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
  verifyLabel = 'Verify Payment & Continue',
  verifySubmitting = false,
  disabled = false,
  onVerify,
  onRecreate,
  expiresAt = null,
}) {
  const isMobile = useIsMobile();
  const [screenshot, setScreenshot] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const fileInputRef = useRef(null);
  const countdown = useCountdown(expiresAt);
  const isExpired = countdown.expired;

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
    if (isExpired) { toast.error('This payment request has expired. Please create a new payment request.'); return; }
    if (!screenshot) { toast.error('Please upload your payment screenshot first'); return; }
    if (typeof onVerify === 'function') onVerify(screenshot);
  };

  const copyUPI = async () => {
    const ok = await copyText(upiId);
    if (ok) toast.success('UPI ID copied!');
    else toast.error('Could not copy automatically — please copy the UPI ID manually.');
  };

  const clearScreenshot = () => {
    setScreenshot(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFileKey(k => k + 1);
  };

  const replaceScreenshot = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  return (
    <div className="space-y-4">
      {onAmountChange && (
        <div>
          <span className="label" id="amount-select-label">Select Amount</span>
          <div
            className="grid grid-cols-3 gap-3"
            role="group"
            aria-labelledby="amount-select-label"
          >
            {amountOptions.map((opt) => {
              const active = Number(amount) === Number(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onAmountChange(opt)}
                  className={`rounded-lg border py-3 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 ${
                    active
                      ? 'border-primary-600 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                      : 'border-line bg-surface text-ink hover:bg-surface-2'
                  }`}
                >
                  <span className="text-lg font-bold">₹{opt}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* QR / payment details card */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold tracking-tight text-ink">JSREE</span>
            <span className="badge badge-info">UPI</span>
          </div>
          <span className="text-xs text-ink-faint">Secure UPI Payment</span>
        </div>

        {expiresAt && (
          <div
            className={`callout mb-4 justify-center ${
              isExpired
                ? 'callout-error'
                : countdown.low
                  ? 'callout-warning'
                  : 'callout-info'
            }`}
            role="status"
          >
            {isExpired ? (
              <>
                <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                <span>Payment request expired. Please create a new payment request to continue.</span>
              </>
            ) : (
              <>
                <Clock className="h-4 w-4 shrink-0 mt-px" />
                <span>
                  Payment request expires in {countdown.minutes}:{String(countdown.seconds).padStart(2, '0')}
                </span>
              </>
            )}
          </div>
        )}

        <div className="rounded-lg bg-surface-2 border border-line divide-y divide-line">
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-sm text-ink-muted">Amount</span>
            <span className="text-xl font-bold text-ink">{formatCurrency(amount || 0)}</span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-sm text-ink-muted">Recipient</span>
            <span className="flex items-center gap-1 text-sm font-semibold text-ink">
              <BadgeCheck className="h-4 w-4 text-primary-600 dark:text-primary-400" /> {recipientName}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <span className="text-sm text-ink-muted shrink-0">UPI ID</span>
            <span className="flex-1 min-w-0 font-mono text-sm font-semibold text-ink break-all text-right">{upiId}</span>
            <button
              type="button"
              onClick={copyUPI}
              className="btn btn-secondary btn-sm shrink-0"
              aria-label="Copy UPI ID"
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
          </div>
        </div>

        <div className="mt-5 text-center">
          <p className="flex items-center justify-center gap-2 font-semibold text-ink">
            <ScanLine className="h-4 w-4 text-primary-600 dark:text-primary-400" /> Scan &amp; Pay
          </p>
          <p className="text-sm text-ink-muted mt-1">Scan this QR with any UPI app (GPay, PhonePe, Paytm &amp; more)</p>

          <div className="mt-3 inline-block rounded-xl border border-line bg-white p-3">
            <QRCodeImage value={upiUri} size={QR_SIZE} className="w-full max-w-[240px] h-auto" />
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Amount {formatCurrency(amount || 0)} is pre-filled. Verify the recipient before you pay.
          </p>

          {isMobile && (
            <a
              href={upiUri}
              className="btn btn-secondary mt-3 w-full sm:w-auto"
            >
              <Smartphone className="h-4 w-4" /> Pay with UPI App
            </a>
          )}
        </div>

        {!validAmount && (
          <p className="callout callout-warning mt-3 justify-center text-center">
            Select a valid payment amount to generate the QR.
          </p>
        )}
      </div>

      {/* Upload / verification card */}
      <div className="card">
        <h3 className="flex items-center gap-2 font-semibold text-ink">
          <CheckCircle2 className="h-4 w-4 text-success-600" /> Payment completed?
        </h3>
        <p className="text-sm text-ink-muted mt-1">
          {isExpired
            ? 'This payment request has expired. Please create a new payment request to continue.'
            : 'Completed the payment in your UPI app? Upload the payment screenshot below and it will be verified.'}
        </p>

        {!isExpired && (
          <div className="callout callout-info mt-3 block">
            <div>
              <p className="font-semibold">Upload the ORIGINAL payment confirmation screenshot from your UPI app.</p>
              <ul className="mt-1.5 space-y-1 text-xs opacity-90">
                <li>• The amount must match {formatCurrency(amount || 0)} exactly</li>
                <li>• The recipient must match {recipientName} ({upiId})</li>
                <li>• Payment status must show Completed / Success</li>
                <li>• Date and time must be visible</li>
                <li>• Transaction / reference ID must be visible</li>
                <li>• The screenshot must be from this current payment request</li>
              </ul>
            </div>
          </div>
        )}

        <div className="mt-4">
          <span className="label" id="upload-label">Upload Payment Screenshot</span>
          <label
            className={`block border border-dashed rounded-xl p-5 text-center transition-colors cursor-pointer ${
              isExpired
                ? 'border-line bg-surface-2 cursor-not-allowed'
                : 'border-line bg-surface-2 hover:border-primary-500/60 hover:bg-primary-500/5'
            }`}
          >
            {preview && screenshot ? (
              <div>
                <img src={preview} alt="Payment screenshot preview" className="max-h-48 mx-auto rounded-lg" />
                <p className="mt-2 text-sm font-medium text-ink break-all">{screenshot.name}</p>
                <p className="text-xs text-ink-faint">{formatFileSize(screenshot.size)}</p>
              </div>
            ) : (
              <div>
                <Upload className="h-8 w-8 text-ink-faint mx-auto mb-2" />
                <p className="text-sm text-ink-muted">{isExpired ? 'Payment request expired' : 'Click to upload JPG, PNG, WEBP'}</p>
              </div>
            )}
            {!isExpired && (
              <input
                key={fileKey}
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleFile}
                aria-labelledby="upload-label"
              />
            )}
          </label>
          <p className="text-xs text-ink-faint mt-1.5">Accepted formats: JPG, PNG, WEBP — max 5MB</p>
          {!isExpired && screenshot && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={replaceScreenshot}
                className="btn btn-secondary flex-1"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Replace file
              </button>
              <button
                type="button"
                onClick={clearScreenshot}
                className="btn btn-secondary flex-1"
                aria-label="Remove selected screenshot"
              >
                <X className="h-3.5 w-3.5" /> Remove
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleVerify}
          disabled={verifySubmitting || disabled || !screenshot || isExpired}
          className="btn btn-primary btn-lg mt-4 w-full"
        >
          <ShieldCheck className="h-4 w-4" /> {verifySubmitting ? 'Verifying...' : verifyLabel}
        </button>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-faint">
          <LockKeyhole className="h-3.5 w-3.5" /> Never share your UPI PIN or OTP.
        </p>

        {isExpired && typeof onRecreate === 'function' && (
          <button
            type="button"
            onClick={onRecreate}
            disabled={verifySubmitting}
            className="btn btn-primary btn-lg mt-4 w-full"
          >
            <RefreshCw className="h-4 w-4" /> Create New Payment Request
          </button>
        )}
      </div>
    </div>
  );
}
