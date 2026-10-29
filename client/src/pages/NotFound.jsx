import { Link } from 'react-router-dom';
import { Shield, Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen landing-bg flex items-center justify-center p-4">
      <div className="text-center relative z-10">
        <Link to="/" className="inline-flex items-center justify-center gap-2.5 mb-8" aria-label="JSREE home">
          <span className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" aria-hidden="true" />
          </span>
          <span className="text-xl font-bold tracking-tight text-ink">JSREE</span>
        </Link>
        <div className="w-14 h-14 rounded-2xl bg-surface border border-line flex items-center justify-center mx-auto mb-6">
          <Compass className="h-7 w-7 text-ink-faint" aria-hidden="true" />
        </div>
        <p className="text-6xl font-bold text-primary-600/30 dark:text-primary-400/30 mb-3 select-none">404</p>
        <h1 className="text-xl font-semibold text-ink mb-2">Page Not Found</h1>
        <p className="text-ink-muted mb-6 text-sm">The page you're looking for doesn't exist or has been moved.</p>
        <Link to="/" className="btn btn-primary">Go Home</Link>
      </div>
    </div>
  );
}
