import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const QR_OPTIONS = {
  margin: 1,
  errorCorrectionLevel: 'M',
  color: { dark: '#0f172a', light: '#ffffff' },
};

export default function QRCodeImage({ value, size = 260, className = '' }) {
  const [dataUrl, setDataUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setDataUrl('');
    if (!value) return undefined;
    QRCode.toDataURL(value, { ...QR_OPTIONS, width: size * 2 })
      .then((url) => { if (active) setDataUrl(url); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [value, size]);

  if (failed) {
    return <div className="flex items-center justify-center py-8 text-sm text-gray-500">Unable to generate QR.</div>;
  }
  if (!dataUrl) {
    return <div className="flex items-center justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" /></div>;
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="UPI Payment QR code"
      className={`aspect-square rounded-lg object-contain ${className}`}
    />
  );
}