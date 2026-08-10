import { Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import FallingStarsBackground from './components/FallingStarsBackground';
import LandingPage from './pages/LandingPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import PaymentStatusPage from './pages/PaymentStatusPage';
import AdminLoginPage from './pages/AdminLoginPage';
import NotFound from './pages/NotFound';
import UserDashboard from './pages/user/Dashboard';
import UserProfile from './pages/user/Profile';
import UserPayments from './pages/user/PaymentStatus';
import UserTopUps from './pages/user/TopUps';
import UserReferrals from './pages/user/Referrals';
import UserChangePlan from './pages/user/ChangePlan';
import UserChat from './pages/user/Chat';
import UserHistory from './pages/user/History';
import UserWallet from './pages/user/Wallet';
import UserNotifications from './pages/user/Notifications';
import UserReceipts from './pages/user/Receipts';
import UserSecurity from './pages/user/Security';
import AdminDashboard from './pages/admin/Dashboard';
import AdminUsers from './pages/admin/Users';
import AdminPayments from './pages/admin/Payments';
import AdminTopUps from './pages/admin/TopUps';
import AdminInactiveUsers from './pages/admin/InactiveUsers';
import AdminPlanChanges from './pages/admin/PlanChanges';
import AdminChat from './pages/admin/Chat';
import AdminAuditLogs from './pages/admin/AuditLogs';
import AdminFinancialReports from './pages/admin/FinancialReports';
import AdminSuspiciousActivity from './pages/admin/SuspiciousActivity';

export default function App() {
  return (
    <ThemeProvider>
      <FallingStarsBackground />
      <div className="relative z-10">
        <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/payment-status" element={<PaymentStatusPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />

        <Route path="/dashboard" element={<ProtectedRoute><Layout><UserDashboard /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/profile" element={<ProtectedRoute><Layout><UserProfile /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/payment" element={<ProtectedRoute><Layout><UserPayments /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/topups" element={<ProtectedRoute><Layout><UserTopUps /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/referrals" element={<ProtectedRoute><Layout><UserReferrals /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/plan-change" element={<ProtectedRoute><Layout><UserChangePlan /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/chat" element={<ProtectedRoute><Layout><UserChat /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/history" element={<ProtectedRoute><Layout><UserHistory /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/wallet" element={<ProtectedRoute><Layout><UserWallet /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/notifications" element={<ProtectedRoute><Layout><UserNotifications /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/receipts" element={<ProtectedRoute><Layout><UserReceipts /></Layout></ProtectedRoute>} />
        <Route path="/dashboard/security" element={<ProtectedRoute><Layout><UserSecurity /></Layout></ProtectedRoute>} />

        <Route path="/admin" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminDashboard /></Layout></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminUsers /></Layout></ProtectedRoute>} />
        <Route path="/admin/payments" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminPayments /></Layout></ProtectedRoute>} />
        <Route path="/admin/topups" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminTopUps /></Layout></ProtectedRoute>} />
        <Route path="/admin/inactive-users" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminInactiveUsers /></Layout></ProtectedRoute>} />
        <Route path="/admin/plan-changes" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminPlanChanges /></Layout></ProtectedRoute>} />
        <Route path="/admin/chat" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminChat /></Layout></ProtectedRoute>} />
        <Route path="/admin/audit-logs" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminAuditLogs /></Layout></ProtectedRoute>} />
        <Route path="/admin/financial-reports" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminFinancialReports /></Layout></ProtectedRoute>} />
        <Route path="/admin/suspicious-activity" element={<ProtectedRoute adminOnly><Layout isAdmin><AdminSuspiciousActivity /></Layout></ProtectedRoute>} />

        <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </ThemeProvider>
  );
}
