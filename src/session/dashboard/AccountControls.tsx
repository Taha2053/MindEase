import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";
import { useEffect, useState, type FormEvent } from "react";
import {
  deleteCloudData,
  getSession,
  loadSyncPreferences,
  saveSyncPreferences,
  signIn,
  signOut,
  signUp,
  syncNow,
  type AuthSession,
  type SyncPreferences,
} from "@/utils/supabase";
import { UserCheck, Shield, Cloud, LogIn, UserPlus, LogOut, Trash2, RefreshCw, Lock, X, Loader2 } from "lucide-react";

export function AccountControls({ compact }: { compact?: boolean }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [preferences, setPreferences] = useState<SyncPreferences>({ profile: false, history: false });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const refreshAuth = () => {
    void Promise.all([getSession(), loadSyncPreferences()]).then(([auth, sync]) => {
      setSession(auth);
      setPreferences(sync);
    }).catch(error => setStatus(error instanceof Error ? error.message : "Could not load account."));
  };

  useEffect(() => {
    refreshAuth();
    const handleStorageChange = (changes: Record<string, browser.Storage.StorageChange>) => {
      if (changes[STORAGE_KEYS.AUTH_SESSION] || changes[STORAGE_KEYS.SYNC_PREFERENCES]) {
        refreshAuth();
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const run = async (operation: () => Promise<AuthSession | null>, success: string) => {
    setBusy(true);
    setStatus("");
    try {
      const next = await operation();
      if (next) setSession(next);
      setStatus(success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Account operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSignUp) {
      await run(
        () => signUp(email.trim(), password),
        "Account created! Check your email if verification is required.",
      );
    } else {
      await run(() => signIn(email.trim(), password), "Successfully signed in.");
    }
  };

  const setSync = async (key: keyof SyncPreferences, checked: boolean) => {
    const next = { ...preferences, [key]: checked };
    setBusy(true);
    try {
      await saveSyncPreferences(next);
      setPreferences(next);
      setStatus(
        checked
          ? "Sync enabled and active."
          : "Sync paused. Cloud copies remain until explicitly deleted.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <>
        <div className={`mindease-account-box ${compact ? "is-compact" : ""}`}>
          <div className="account-box-head">
            <div className="account-icon-badge">
              <Cloud size={16} />
            </div>
            <div style={{ flex: 1 }}>
              <span className="account-user-tag">Storage Status</span>
              <h4 className="account-box-title">Running in Device-Local Mode</h4>
              <p className="account-box-sub">
                Your lessons, videos, and settings are preserved privately on this device. Sign in or connect Supabase Cloud if you wish to synchronize across machines.
              </p>
            </div>
            <button
              type="button"
              className="btn-acc-primary"
              style={{ whiteSpace: "nowrap", flex: "none" }}
              onClick={() => {
                setShowModal(true);
                setStatus("");
              }}
            >
              <LogIn size={14} />
              <span>Connect Cloud</span>
            </button>
          </div>
          {status && <p role="status" style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--text-dim)" }}>{status}</p>}
        </div>

        {showModal && (
          <div className="auth-modal-backdrop" onClick={() => setShowModal(false)}>
            <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="auth-modal-header">
                <div className="auth-modal-title">
                  <div className="auth-icon-wrap">
                    <Lock size={16} />
                  </div>
                  <div>
                    <h4>{isSignUp ? "Create MindEase Account" : "Sign In to MindEase"}</h4>
                    <p>Connect Supabase Cloud to sync your learning profile and review folders.</p>
                  </div>
                </div>
                <button type="button" className="auth-modal-close" onClick={() => setShowModal(false)} aria-label="Close">
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={(e) => void handleSubmit(e).then(() => setShowModal(false))} className="auth-modal-form">
                <div className="auth-field">
                  <label htmlFor="acc-modal-email">Email Address</label>
                  <input
                    id="acc-modal-email"
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>

                <div className="auth-field">
                  <label htmlFor="acc-modal-pass">Password</label>
                  <input
                    id="acc-modal-pass"
                    type="password"
                    required
                    minLength={6}
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                  />
                </div>

                {status && <div className="auth-error-msg">{status}</div>}

                <div className="auth-modal-actions">
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-acc-primary"
                    onClick={() => setIsSignUp(false)}
                  >
                    {busy && !isSignUp ? <Loader2 size={13} className="spin" /> : <LogIn size={13} />}
                    <span>Sign In</span>
                  </button>

                  <button
                    type="submit"
                    disabled={busy || !email || password.length < 6}
                    className="btn-acc-secondary"
                    onClick={() => setIsSignUp(true)}
                  >
                    {busy && isSignUp ? <Loader2 size={13} className="spin" /> : <UserPlus size={13} />}
                    <span>Create Account</span>
                  </button>
                </div>

                <button type="button" className="auth-fallback-btn" onClick={() => setShowModal(false)}>
                  Cancel &mdash; continue locally
                </button>
              </form>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className={`mindease-account-box ${compact ? "is-compact" : ""}`}>
      <div className="account-box-head">
        <div className="account-icon-badge is-active">
          <UserCheck size={16} />
        </div>
        <div>
          <span className="account-user-tag">Connected Cloud Profile</span>
          <h4 className="account-box-title">{session.user.email || "MindEase Account"}</h4>
        </div>
      </div>

      <div className="sync-toggles-card">
        <label className="clean-checkbox-row">
          <input
            type="checkbox"
            checked={preferences.profile}
            disabled={busy}
            onChange={(e) => void setSync("profile", e.target.checked)}
          />
          <div>
            <strong>Sync Learning Profile</strong>
            <p>Backup baseline reading preferences, format choices, and overrides.</p>
          </div>
        </label>

        <label className="clean-checkbox-row">
          <input
            type="checkbox"
            checked={preferences.history}
            disabled={busy}
            onChange={(e) => void setSync("history", e.target.checked)}
          />
          <div>
            <strong>Sync Session History</strong>
            <p>Preserve completed study sessions, concept counts, and focus logs.</p>
          </div>
        </label>
      </div>

      <div className="account-toolbar-row">
        <button
          disabled={busy}
          type="button"
          className="btn-acc-tool"
          onClick={() =>
            void syncNow()
              .then(() => setStatus("Sync complete."))
              .catch((err) => setStatus(String(err)))
          }
        >
          <RefreshCw size={13} />
          <span>Sync Now</span>
        </button>

        <button
          disabled={busy}
          type="button"
          className="btn-acc-tool danger"
          onClick={() =>
            void deleteCloudData()
              .then(() => setStatus("Cloud data cleared."))
              .catch((err) => setStatus(String(err)))
          }
        >
          <Trash2 size={13} />
          <span>Wipe Cloud</span>
        </button>

        <button
          disabled={busy}
          type="button"
          className="btn-acc-tool"
          onClick={() =>
            void signOut().then(() => {
              setSession(null);
              setStatus("Signed out. Local profile remains active.");
            })
          }
        >
          <LogOut size={13} />
          <span>Sign Out</span>
        </button>
      </div>

      {status && (
        <p className="account-feedback-msg" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}
