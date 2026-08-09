export function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

export function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getStatusColor(status) {
  const colors = {
    active: 'text-green-600 bg-green-50',
    inactive: 'text-red-600 bg-red-50',
    pending: 'text-yellow-600 bg-yellow-50',
    approved: 'text-green-600 bg-green-50',
    rejected: 'text-red-600 bg-red-50',
    completed: 'text-green-600 bg-green-50',
  };
  return colors[status?.toLowerCase()] || 'text-gray-600 bg-gray-50';
}

export function getStatusBadge(status) {
  return `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusColor(status)}`;
}

export function truncate(str, length = 50) {
  if (!str) return '';
  return str.length > length ? str.substring(0, length) + '...' : str;
}

export function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  return Promise.resolve();
}
