import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { deriveLogin } from '../../crypto/zk';
import type { User } from '../../types';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../auth/AuthContext';
import { SkeletonTable, SpinnerInline } from '../../components/Skeleton';
import { formatDate, formatApiError } from '../../utils/format';

export function UsersSettings() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  async function refresh() {
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      toast.error(formatApiError(e, 'Erreur lors du chargement des utilisateurs'));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function askDelete(u: User) {
    if (u.id === me?.id) return toast.error('Impossible de supprimer son propre compte.');
    setDeleteTarget(u);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteUser(deleteTarget.id);
      toast.ok(`Utilisateur ${deleteTarget.username} supprimé`);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      toast.error(formatApiError(e, "Erreur lors de la suppression de l'utilisateur"));
      setDeleteTarget(null);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <div>
          <h3>Utilisateurs</h3>
          <p className="muted small">
            {users?.length ?? '—'} compte{(users?.length ?? 0) > 1 ? 's' : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          + Nouvel utilisateur
        </button>
      </div>

      {users === null ? (
        <SkeletonTable rows={5} cols={6} hasActions caption="Chargement des utilisateurs…" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th>Créé le</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={7} className="empty" data-label="">Aucun utilisateur.</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id}>
                    <td data-label="Username" className="cn">{u.username}{u.id === me?.id && <span className="muted"> (moi)</span>}</td>
                    <td data-label="Email" className="muted">{u.email || '—'}</td>
                    <td data-label="Rôle">
                      {u.role === 'ADMIN' ? (
                        <span className="status-badge status-valid">Admin</span>
                      ) : (
                        <span className="status-badge">User</span>
                      )}
                    </td>
                    <td data-label="Statut">
                      {u.active ? (
                        <span className="status-badge status-valid">Actif</span>
                      ) : (
                        <span className="status-badge status-revoked">Désactivé</span>
                      )}
                    </td>
                    <td data-label="Dernière connexion" className="muted">{formatDate(u.lastLoginAt)}</td>
                    <td data-label="Créé le" className="muted">{formatDate(u.createdAt)}</td>
                    <td data-label="">
                      <div className="action-cell">
                        <button className="btn btn-tiny" onClick={() => setEditTarget(u)}>Éditer</button>
                        <button
                          className="btn btn-tiny btn-danger"
                          onClick={() => askDelete(u)}
                          disabled={u.id === me?.id}
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <Modal title="Nouvel utilisateur" onClose={() => setCreateOpen(false)}>
          <CreateUserForm
            onCancel={() => setCreateOpen(false)}
            onSuccess={async () => {
              setCreateOpen(false);
              toast.ok('Utilisateur créé');
              await refresh();
            }}
          />
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Éditer ${editTarget.username}`} onClose={() => setEditTarget(null)}>
          <EditUserForm
            user={editTarget}
            onCancel={() => setEditTarget(null)}
            onSuccess={async () => {
              setEditTarget(null);
              toast.ok('Utilisateur mis à jour');
              await refresh();
            }}
          />
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Supprimer l'utilisateur"
          danger
          confirmLabel="Supprimer"
          message={
            <>
              Voulez-vous vraiment supprimer <strong>{deleteTarget.username}</strong> ?
              Cette action est <strong>irréversible</strong>.
            </>
          }
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function CreateUserForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<{ username: string; password: string; email: string; role: 'ADMIN' | 'USER' }>({
    username: '', password: '', email: '', role: 'USER',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Le authHash est dérivé ici, dans le navigateur : le mot de passe
      // temporaire ne transite jamais en clair vers le serveur. Le sel est le
      // nom du nouvel utilisateur.
      const { authHash } = await deriveLogin(form.username, form.password);
      await api.createUser({
        username: form.username,
        authHash,
        email: form.email || undefined,
        role: form.role,
      });
      onSuccess();
    } catch (err) {
      setError(formatApiError(err, "Erreur lors de la création de l'utilisateur"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="user-create-username">Username</label>
          <input
            id="user-create-username"
            required
            value={form.username}
            onChange={e => setForm({ ...form, username: e.target.value })}
            autoFocus
            aria-invalid={!!error}
            aria-describedby={error ? 'user-create-error' : undefined}
          />
        </div>
        <div className="field full">
          <label htmlFor="user-create-email">Email (optionnel)</label>
          <input id="user-create-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field full">
          <label htmlFor="user-create-password">Mot de passe temporaire (12 caractères min)</label>
          <input
            id="user-create-password"
            type="password"
            required
            minLength={12}
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            aria-invalid={!!error}
            aria-describedby="user-create-password-hint"
          />
          <span id="user-create-password-hint" className="hint">
            L'utilisateur s'en sert pour sa première connexion, initialise son
            Lockey, puis pourra le changer. Communiquez-le-lui par un canal sûr.
          </span>
        </div>
        <div className="field full">
          <label htmlFor="user-create-role">Rôle</label>
          <select
            id="user-create-role"
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value as 'ADMIN' | 'USER' })}
          >
            <option value="USER">Utilisateur (accès à Lockey)</option>
            <option value="ADMIN">Administrateur (gestion users, settings, journal)</option>
          </select>
        </div>
      </div>
      {error && <div id="user-create-error" className="form-error" role="alert">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <SpinnerInline label="Création" />}
          {busy ? 'Création…' : 'Créer'}
        </button>
      </div>
    </form>
  );
}

function EditUserForm({ user, onSuccess, onCancel }: { user: User; onSuccess: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<{ active: boolean; email: string; role: 'ADMIN' | 'USER' }>({
    active: user.active,
    email: user.email || '',
    role: user.role,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {
        active: form.active,
        email: form.email || null,
      };
      if (form.role !== user.role) patch.role = form.role;
      await api.updateUser(user.id, patch);
      onSuccess();
    } catch (err) {
      setError(formatApiError(err, "Erreur lors de la mise à jour de l'utilisateur"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="user-edit-status">Statut</label>
          <select
            id="user-edit-status"
            value={form.active ? '1' : '0'}
            onChange={e => setForm({ ...form, active: e.target.value === '1' })}
          >
            <option value="1">Actif</option>
            <option value="0">Désactivé</option>
          </select>
        </div>
        <div className="field full">
          <label htmlFor="user-edit-role">Rôle</label>
          <select
            id="user-edit-role"
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value as 'ADMIN' | 'USER' })}
          >
            <option value="USER">Utilisateur</option>
            <option value="ADMIN">Administrateur</option>
          </select>
          <span className="hint">
            Changer le rôle ou désactiver le compte invalide les sessions actives de cet utilisateur.
          </span>
        </div>
        <div className="field full">
          <label htmlFor="user-edit-email">Email</label>
          <input id="user-edit-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field full">
          <p className="hint" style={{ margin: 0 }}>
            Le chiffrement zéro-connaissance empêche un administrateur de
            réinitialiser le mot de passe d'un autre utilisateur. En cas d'oubli,
            l'utilisateur utilise son code de récupération depuis l'écran de
            connexion.
          </p>
        </div>
      </div>
      {error && <div id="user-edit-error" className="form-error" role="alert">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <SpinnerInline label="Mise à jour" />}
          {busy ? 'Mise à jour…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
