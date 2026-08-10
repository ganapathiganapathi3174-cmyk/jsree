export default function Avatar({ user, size = 40, className = '' }) {
  const avatarUrl = user?.avatar_url;
  const name = user?.full_name || user?.fullName || user?.name || 'JSREE';
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const sizeClass =
    size <= 32 ? 'text-xs' : size <= 48 ? 'text-sm' : size <= 72 ? 'text-lg' : 'text-2xl';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{ width: size, height: size }}
        className={`rounded-full object-cover ring-2 ring-white/20 ${className}`}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-full flex items-center justify-center font-semibold bg-gradient-to-br from-indigo-500 to-purple-600 text-white ring-2 ring-white/20 ${sizeClass} ${className}`}
    >
      {initials}
    </div>
  );
}
