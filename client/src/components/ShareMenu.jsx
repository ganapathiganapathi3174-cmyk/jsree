import { useState, useRef, useEffect } from 'react';
import { Share2, MessageCircle, Send, Facebook, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

const shareOptions = [
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    chip: 'bg-emerald-50 text-emerald-600',
    buildUrl: (link, text) => `https://wa.me/?text=${encodeURIComponent(text)}`,
  },
  {
    key: 'telegram',
    label: 'Telegram',
    icon: Send,
    chip: 'bg-sky-50 text-sky-600',
    buildUrl: (link, text) => `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    icon: Facebook,
    chip: 'bg-blue-50 text-blue-600',
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

  const buttonClass = variant === 'primary' ? 'btn-primary' : 'btn-secondary';

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
          className="absolute right-0 z-50 mt-2 w-60 rounded-xl bg-slate-900/95 backdrop-blur-2xl border border-slate-500/20 shadow-elevation p-2"
        >
          <p className="px-2 pt-1 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Share via</p>
          <div className="space-y-0.5">
            {shareOptions.map((opt) => (
              <button
                key={opt.key}
                role="menuitem"
                onClick={() => openShare(opt.buildUrl(link, text))}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left text-sm text-slate-200 hover:bg-white/[0.06] transition-colors"
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
              className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left text-sm text-slate-200 hover:bg-white/[0.06] transition-colors"
            >
              <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.08] text-slate-300">
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