import { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

export default function PasswordInput({ className = '', ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
      <input
        className={`input-field pl-10 pr-10 ${className}`}
        type={visible ? 'text' : 'password'}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute right-3 top-3 h-4 w-4 text-gray-400 hover:text-gray-600 focus:outline-none"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
