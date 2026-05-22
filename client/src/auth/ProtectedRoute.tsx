import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { UnlockScreen } from '../pages/UnlockScreen';
import { InitVaultScreen } from '../pages/InitVaultScreen';
import type { ReactNode } from 'react';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, vaultKey, vaultInitialized } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Compte créé par un admin dont le Lockey n'a jamais été initialisé.
  if (!vaultInitialized) {
    return <InitVaultScreen />;
  }

  // Session valide mais Lockey verrouillé (rechargement, verrouillage auto).
  if (!vaultKey) {
    return <UnlockScreen />;
  }

  return <>{children}</>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}
