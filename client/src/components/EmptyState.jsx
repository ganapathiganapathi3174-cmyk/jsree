import { Inbox } from 'lucide-react';

export default function EmptyState({
  icon = <Inbox className="h-6 w-6" />,
  title = 'No data found',
  description = 'There are no records to display.',
  action,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="w-12 h-12 bg-surface-2 border border-line rounded-full flex items-center justify-center mb-4 text-ink-faint">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-ink mb-1">{title}</h3>
      <p className="text-sm text-ink-muted max-w-sm mb-5">{description}</p>
      {action && (
        <button onClick={action.onClick} className="btn btn-primary">
          {action.label}
        </button>
      )}
    </div>
  );
}
