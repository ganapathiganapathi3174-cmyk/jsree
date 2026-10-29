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

  const variantClass = {
    danger: 'btn-danger',
    success: 'btn-success',
    warning: 'btn-warning',
  }[confirmVariant] || 'btn-danger';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="sm">
      <p className="text-ink-muted text-sm leading-relaxed mb-6 whitespace-pre-line">{message}</p>
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 sm:justify-end">
        <button onClick={handleClose} disabled={loading} className="btn btn-secondary">
          Cancel
        </button>
        <button onClick={handleConfirm} disabled={loading} className={`btn ${variantClass}`}>
          {loading ? 'Processing...' : confirmText}
        </button>
      </div>
    </Modal>
  );
}
