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
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    success: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="sm">
      <p className="text-gray-600 mb-6">{message}</p>
      <div className="flex items-center gap-3 justify-end">
        <button
          onClick={handleClose}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
            variantClasses[confirmVariant] || variantClasses.danger
          }`}
        >
          {loading ? 'Processing...' : confirmText}
        </button>
      </div>
    </Modal>
  );
}
