import { Inbox } from 'lucide-react';

export default function EmptyState({
  icon = <Inbox className="h-12 w-12" />,
  title = 'No data found',
  description = 'There are no records to display.',
  action,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-16 h-16 bg-white/[0.05] border border-slate-500/20 rounded-full flex items-center justify-center mb-4 text-slate-500 shadow-glow-sm">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-slate-100 mb-1">{title}</h3>
      <p className="text-sm text-slate-400 text-center max-w-sm mb-4">
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}