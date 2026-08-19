import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-600 to-primary-700 rounded-lg flex items-center justify-center shadow-sm">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-gray-900">JSREE</span>
        </div>
        <h1 className="text-7xl font-bold text-gray-200 mb-4">404</h1>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Page Not Found</h2>
        <p className="text-gray-500 mb-6">The page you're looking for doesn't exist.</p>
        <Link to="/" className="btn-primary">Go Home</Link>
      </div>
    </div>
  );
}