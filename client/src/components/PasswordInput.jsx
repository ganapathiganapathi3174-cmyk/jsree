import { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

export default function PasswordInput({ className = '', ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" />
      <input
        className={`input-field pl-10 pr-11 ${className}`}
        type={visible ? 'text' : 'password'}
        {...props}
      />
      <button
        type="button"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-ink-faint hover:text-ink hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={0}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
