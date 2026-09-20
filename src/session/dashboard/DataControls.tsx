import { useState } from "react";
import { deleteAllUserData, exportUserData } from "@/utils/userData";
import { AccountControls } from "./AccountControls";

export function DataControls() {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const data = await exportUserData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `mindease-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click(); URL.revokeObjectURL(url);
      setStatus("Learner data exported. Provider keys were excluded.");
    } catch { setStatus("Data could not be exported."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const count = await deleteAllUserData();
      setStatus(`${count} stored learner-data entries deleted. Reloading…`);
      setTimeout(() => window.location.reload(), 700);
    } catch { setStatus("Data could not be deleted."); setBusy(false); }
  };

  return <section className="section-card data-controls" id="section-data" data-section="data">
    <h2>Your data</h2>
    <p>Profile and session data currently stay in this browser. Adapted source text is sent to the providers named in the adaptation prompt.</p>
    <div className="feedback-actions">
      <button type="button" disabled={busy} onClick={download}>Export learner data</button>
      {!confirming ? <button type="button" disabled={busy} onClick={() => setConfirming(true)}>Delete learner data</button> :
        <><span>This removes profiles, sessions, feedback, notes, and cached visuals from this browser.</span>
          <button type="button" disabled={busy} onClick={remove}>Confirm deletion</button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button></>}
    </div>
    <p role="status" aria-live="polite">{status}</p>
    <AccountControls />
  </section>;
}
