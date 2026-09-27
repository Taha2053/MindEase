import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";
import { useState, useEffect, type FormEvent } from "react";
import {
  getStorageConfig,
  saveStorageConfig,
  type StorageDestinationConfig,
} from "@/utils/sessionStorageManager";
import { getSession, signIn, signUp, type AuthSession } from "@/utils/supabase";
import {
  HardDrive,
  Cloud,
  FolderCheck,
  Check,
  Sparkles,
  Lock,
  X,
  LogIn,
  UserPlus,
  Loader2,
} from "lucide-react";

export function StorageDestinationSelector({ compact }: { compact?: boolean }) {
  const [config, setConfig] = useState<StorageDestinationConfig | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [saved, setSaved] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);

  // Mandatory Auth Modal state when user selects Supabase
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const refreshState = () => {
    void Promise.all([getStorageConfig(), getSession()]).then(([cfg, sess]) => {
      setConfig(cfg);
      setLocalPath(cfg.localPath);
      setSession(sess);

      // If config says supabase but user is not logged in, enforce fallback to local
      if (cfg.destination === "supabase" && !sess) {
        void saveStorageConfig({ destination: "local" }).then((corrected) => {
          setConfig(corrected);
        });
      }
    });
  };

  useEffect(() => {
    refreshState();
    const handleStorageChange = (changes: Record<string, unknown>) => {
      if (changes[STORAGE_KEYS.AUTH_SESSION] || changes[STORAGE_KEYS.STORAGE_DESTINATION]) {
        refreshState();
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);
  if (!config) return null;

  const handleSelectMode = async (mode: "local" | "supabase") => {
    if (mode === "local") {
      setShowAuthModal(false);
      const updated = await saveStorageConfig({ destination: "local" });
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }

    // Supabase mode requested: verify existing session first
    const activeSession = await getSession();
    if (activeSession) {
      setSession(activeSession);
      const updated = await saveStorageConfig({ destination: "supabase" });
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }

    // No session: open mandatory auth modal
    setAuthEmail("");
    setAuthPassword("");
    setAuthError("");
    setIsSignUp(false);
    setShowAuthModal(true);
  };

  const handleCancelAuth = async () => {
    setShowAuthModal(false);
    setAuthBusy(false);
    // Explicit fallback to local
    const updated = await saveStorageConfig({ destination: "local" });
    setConfig(updated);
  };

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      let loggedIn: AuthSession | null = null;
      if (isSignUp) {
        loggedIn = await signUp(authEmail.trim(), authPassword);
      } else {
        loggedIn = await signIn(authEmail.trim(), authPassword);
      }

      if (loggedIn) {
        setSession(loggedIn);
        const updated = await saveStorageConfig({ destination: "supabase" });
        setConfig(updated);
        setShowAuthModal(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setAuthError("Account created. Please verify your email or sign in.");
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSavePath = async () => {
    const trimmed = localPath.trim() || "MindEase/Lessons";
    const updated = await saveStorageConfig({ localPath: trimmed });
    setConfig(updated);
    setLocalPath(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div className={`storage-dest-card ${compact ? "is-compact" : ""}`}>
        {!compact && (
          <div className="storage-dest-header">
            <div className="dest-icon-wrap">
              <FolderCheck size={18} />
            </div>
            <div>
              <h4 className="dest-title">Storage &amp; Archive Destination</h4>
              <p className="dest-desc">
                Choose where generated videos, visuals, and session histories are saved.
              </p>
            </div>
          </div>
        )}

        <div className="dest-options-grid">
          <button
            type="button"
            className={`dest-option-btn ${config.destination === "local" ? "is-active" : ""}`}
            onClick={() => handleSelectMode("local")}
          >
            <div className="dest-radio-indicator">
              {config.destination === "local" && <div className="dest-radio-dot" />}
            </div>
            <div className="dest-btn-body">
              <div className="dest-btn-label-row">
                <HardDrive size={15} className="dest-opt-icon" />
                <strong>Local Folder</strong>
              </div>
              <span className="dest-btn-sub">Saved in date-stamped session subfolders</span>
            </div>
          </button>

          <button
            type="button"
            className={`dest-option-btn ${config.destination === "supabase" ? "is-active" : ""}`}
            onClick={() => handleSelectMode("supabase")}
          >
            <div className="dest-radio-indicator">
              {config.destination === "supabase" && <div className="dest-radio-dot" />}
            </div>
            <div className="dest-btn-body">
              <div className="dest-btn-label-row">
                <Cloud size={15} className="dest-opt-icon" />
                <strong>Supabase Cloud</strong>
                <span className="dest-req-badge">Account Required</span>
              </div>
              <span className="dest-btn-sub">
                {session ? `Connected as ${session.user.email || "user"}` : "Sign in or sign up to activate"}
              </span>
            </div>
          </button>
        </div>

        {config.destination === "local" ? (
          <div className="dest-path-config">
            <label htmlFor="local-lessons-path">Folder Path</label>
            <div className="dest-path-row">
              <input
                id="local-lessons-path"
                type="text"
                value={localPath}
                placeholder="MindEase/Lessons"
                onChange={(e) => setLocalPath(e.target.value)}
                onBlur={handleSavePath}
              />
              <button type="button" className="btn-save-path" onClick={handleSavePath}>
                {saved ? <Check size={13} /> : "Save"}
              </button>
            </div>
            <span className="dest-path-hint">
              Sessions are structured as: <code>{localPath.replace(/\/+$/, "")}/YYYY-MM-DD_Session-XX/</code>
            </span>
          </div>
        ) : (
          <div className="dest-cloud-hint">
            <Sparkles size={14} className="dest-sparkle" />
            <span>
              Sessions will be archived to your private bucket under <code>lessons/YYYY-MM-DD_Session-XX/</code>.
            </span>
          </div>
        )}

        {saved && <div className="dest-saved-toast">Storage settings updated!</div>}
      </div>

      {/* Mandatory Supabase Sign-in / Sign-up Modal */}
      {showAuthModal && (
        <div className="auth-modal-backdrop" onClick={handleCancelAuth}>
          <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-header">
              <div className="auth-modal-title">
                <div className="auth-icon-wrap">
                  <Lock size={16} />
                </div>
                <div>
                  <h4>Supabase Account Required</h4>
                  <p>Sign in or create an account to enable cloud storage.</p>
                </div>
              </div>
              <button type="button" className="auth-modal-close" onClick={handleCancelAuth} aria-label="Cancel">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="auth-modal-form">
              <div className="auth-field">
                <label htmlFor="auth-modal-email">Email Address</label>
                <input
                  id="auth-modal-email"
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="auth-field">
                <label htmlFor="auth-modal-pass">Password</label>
                <input
                  id="auth-modal-pass"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Minimum 8 characters"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                />
              </div>

              {authError && <div className="auth-error-msg">{authError}</div>}

              <div className="auth-modal-actions">
                <button
                  type="submit"
                  disabled={authBusy}
                  className="btn-acc-primary"
                  onClick={() => setIsSignUp(false)}
                >
                  {authBusy && !isSignUp ? <Loader2 size={13} className="spin" /> : <LogIn size={13} />}
                  <span>Sign In &amp; Activate</span>
                </button>

                <button
                  type="submit"
                  disabled={authBusy || !authEmail || authPassword.length < 8}
                  className="btn-acc-secondary"
                  onClick={() => setIsSignUp(true)}
                >
                  {authBusy && isSignUp ? <Loader2 size={13} className="spin" /> : <UserPlus size={13} />}
                  <span>Create Account</span>
                </button>
              </div>

              <button type="button" className="auth-fallback-btn" onClick={handleCancelAuth}>
                Cancel &mdash; keep saving locally
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
