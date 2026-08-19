import { useState } from 'react';
import Modal from './Modal';

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  confirmVariant = 'danger',
}) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) onClose();
  };

  const variantClasses = {
    danger: 'bg-error-600 hover:bg-error-700 focus-visible:ring-error-500',
    success: 'bg-success-600 hover:bg-success-700 focus-visible:ring-success-500',
    warning: 'bg-warning-600 hover:bg-warning-700 focus-visible:ring-warning-500',
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="sm">
      <p className="text-slate-400 text-sm leading-relaxed mb-6 whitespace-pre-line">{message}</p>
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 sm:justify-end">
        <button
          onClick={handleClose}
          disabled={loading}
          className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className={`px-5 py-2 text-sm font-medium text-white rounded-xl shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
            variantClasses[confirmVariant] || variantClasses.danger
          }`}
        >
          {loading ? 'Processing...' : confirmText}
        </button>
      </div>
    </Modal>
  );
}