import { useEffect, useState, type FormEvent } from "react";
import {
  deleteCloudData, getSession, loadSyncPreferences, saveSyncPreferences,
  signIn, signOut, signUp, syncNow,
  type AuthSession, type SyncPreferences,
} from "@/utils/supabase";

export function AccountControls() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [preferences, setPreferences] = useState<SyncPreferences>({ profile: false, history: false });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => { void Promise.all([getSession(), loadSyncPreferences()]).then(([auth, sync]) => { setSession(auth); setPreferences(sync); }); }, []);

  const run = async (operation: () => Promise<AuthSession | null>, success: string) => {
    setBusy(true); setStatus("");
    try { const next = await operation(); if (next) setSession(next); setStatus(success); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Account operation failed."); }
    finally { setBusy(false); }
  };

  const submit = (mode: "signin" | "signup") => async (event: FormEvent) => {
    event.preventDefault();
    await run(() => mode === "signin" ? signIn(email.trim(), password) : signUp(email.trim(), password), mode === "signin" ? "Signed in." : "Account created. Check your email if confirmation is enabled.");
  };

  const setSync = async (key: keyof SyncPreferences, checked: boolean) => {
    const next = { ...preferences, [key]: checked };
    setBusy(true);
    try { await saveSyncPreferences(next); setPreferences(next); setStatus(checked ? "Synchronization enabled and local data uploaded." : "Synchronization disabled. Existing cloud data remains until you delete it."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Synchronization failed."); }
    finally { setBusy(false); }
  };

  if (!session) return <section className="account-panel" aria-labelledby="account-heading">
    <h3 id="account-heading">Optional MindEase account</h3>
    <p>Local mode works without an account. Sign in only if you want synchronization across devices.</p>
    <form className="account-form" onSubmit={submit("signin")}>
      <label>Email<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <div className="feedback-actions"><button disabled={busy} type="submit">Sign in</button><button disabled={busy || !email || password.length < 8} type="button" onClick={() => void run(() => signUp(email.trim(), password), "Account created. Check your email if confirmation is enabled.")}>Create account</button></div>
    </form>
    <p role="status" aria-live="polite">{status}</p>
  </section>;

  return <section className="account-panel" aria-labelledby="account-heading">
    <h3 id="account-heading">Account and synchronization</h3>
    <p>Signed in as <strong>{session.user.email || "MindEase user"}</strong>. Synchronization is optional and controlled separately.</p>
    <label className="sync-choice"><input type="checkbox" checked={preferences.profile} disabled={busy} onChange={event => void setSync("profile", event.target.checked)} /> Synchronize my learning profile</label>
    <label className="sync-choice"><input type="checkbox" checked={preferences.history} disabled={busy} onChange={event => void setSync("history", event.target.checked)} /> Synchronize my session history</label>
    <div className="feedback-actions">
      <button disabled={busy} type="button" onClick={() => void syncNow().then(() => setStatus("Synchronization complete.")).catch(error => setStatus(String(error)))}>Sync now</button>
      <button disabled={busy} type="button" onClick={() => void deleteCloudData().then(() => setStatus("Cloud profile and history deleted.")).catch(error => setStatus(String(error)))}>Delete cloud data</button>
      <button disabled={busy} type="button" onClick={() => void signOut().then(() => { setSession(null); setStatus("Signed out. Local data remains available."); })}>Sign out</button>
    </div>
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}
