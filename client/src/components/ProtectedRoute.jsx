import { Navigate, useLocation } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';

const pendingStatuses = ['pending', 'inactive', 'suspended'];

export default function ProtectedRoute({ children, adminOnly = false }) {
  const location = useLocation();
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;

  if (!token || !user) {
    const loginPath = adminOnly || location.pathname.startsWith('/admin')
      ? '/admin/login'
      : '/login';
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  if (!adminOnly && user.role === 'admin' && !location.pathname.startsWith('/admin')) {
    return <Navigate to="/admin" replace />;
  }

  // A non-admin whose initial registration payment is not yet approved must
  // only see the payment status page until their account is activated.
  if (!adminOnly && pendingStatuses.includes(user.status)) {
    return <Navigate to="/payment-status" replace />;
  }

  return children;
}
