import { useState, useRef, useEffect } from 'react';
import { Share2, MessageCircle, Send, Facebook, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

const shareOptions = [
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    chip: 'bg-success-500/15 text-success-700 dark:text-success-400',
    buildUrl: (link, text) => `https://wa.me/?text=${encodeURIComponent(text)}`,
  },
  {
    key: 'telegram',
    label: 'Telegram',
    icon: Send,
    chip: 'bg-info-500/15 text-info-700 dark:text-info-400',
    buildUrl: (link, text) => `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    icon: Facebook,
    chip: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
    buildUrl: (link) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
  },
];

export default function ShareMenu({ link, text, label = 'Share', variant = 'secondary' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openShare = (url) => {
    setOpen(false);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied!');
    } catch {
      toast.error('Could not copy link');
    }
    setOpen(false);
  };

  const buttonClass = variant === 'primary' ? 'btn btn-primary' : 'btn btn-secondary';

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 className="h-4 w-4" />
        <span>{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 rounded-lg bg-surface border border-line shadow-elevation p-2"
        >
          <p className="px-2 pt-1 pb-2 text-xs font-semibold text-ink-faint uppercase tracking-wide">Share via</p>
          <div className="space-y-0.5">
            {shareOptions.map((opt) => (
              <button
                key={opt.key}
                role="menuitem"
                onClick={() => openShare(opt.buildUrl(link, text))}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left text-sm text-ink-muted hover:bg-surface-2 hover:text-ink transition-colors"
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${opt.chip}`}>
                  <opt.icon className="h-4 w-4" />
                </span>
                {opt.label}
              </button>
            ))}
            <button
              role="menuitem"
              onClick={copyLink}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left text-sm text-ink-muted hover:bg-surface-2 hover:text-ink transition-colors"
            >
              <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 text-ink-muted">
                <Copy className="h-4 w-4" />
              </span>
              Copy Link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
