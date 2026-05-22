import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute, AdminRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { RecoverPage } from './pages/RecoverPage';
import { DashboardPage } from './pages/DashboardPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { SettingsPage } from './pages/SettingsPage';
import { VaultPage } from './pages/VaultPage';
import { RecoveryCodeModal } from './components/RecoveryCodeModal';

export default function App() {
  const { pendingRecoveryCode, clearPendingRecoveryCode } = useAuth();

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/audit" element={<AdminRoute><AuditLogPage /></AdminRoute>} />
          <Route path="/users" element={<Navigate to="/settings?tab=utilisateurs" replace />} />
          <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      {pendingRecoveryCode && (
        <RecoveryCodeModal code={pendingRecoveryCode} onClose={clearPendingRecoveryCode} />
      )}
    </>
  );
}
