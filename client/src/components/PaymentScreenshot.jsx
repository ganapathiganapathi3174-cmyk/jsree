import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import api from '../utils/api';

// Authenticated payment-screenshot viewer.
//
// Payment proofs are fetched through the access-controlled API proxy
// (ownership-checked, no raw storage URL) as a blob and rendered via an
// object URL. This keeps screenshots out of public CDN links and enforces
// "owner or admin only" at the application layer.
export default function PaymentScreenshot({
  endpoint,
  alt = 'Payment screenshot',
  className = 'w-full rounded-lg border border-line max-h-80 object-contain bg-surface-2',
}) {
  const [src, setSrc] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setState('loading');
    api.get(endpoint, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint]);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center rounded-lg border border-line bg-surface-2 h-40 text-ink-faint text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading screenshot…
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-surface-2 h-40 text-ink-muted text-sm gap-2">
        <ImageOff className="h-6 w-6 text-ink-faint" />
        <span>Unable to load screenshot</span>
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} />;
}
