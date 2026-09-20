import { useEffect, useState, type FormEvent } from "react";
import { deleteFeedback, loadFeedback, saveFeedback, type SessionFeedback } from "../feedback";

export function SessionFeedbackPanel({ sessionId }: { sessionId?: string }) {
  const [helpfulness, setHelpfulness] = useState<SessionFeedback["helpfulness"] | "">("");
  const [confidence, setConfidence] = useState<SessionFeedback["confidence"] | "">("");
  const [preferredFormat, setPreferredFormat] = useState<SessionFeedback["preferredFormat"]>("unchanged");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setHelpfulness(""); setConfidence(""); setComment(""); setPreferredFormat("unchanged"); setSaved(false); setStatus("");
    if (!sessionId) { setBusy(false); return; }
    loadFeedback(sessionId).then(entry => {
      if (!active || !entry) return;
      setHelpfulness(entry.helpfulness); setConfidence(entry.confidence);
      setPreferredFormat(entry.preferredFormat); setComment(entry.comment); setSaved(true);
    }).catch(() => { if (active) setStatus("Saved feedback could not be loaded."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [sessionId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId || !helpfulness || !confidence || busy) return;
    setBusy(true);
    try {
      await saveFeedback({ sessionId, helpfulness, confidence, preferredFormat, comment, updatedAt: Date.now() });
      setSaved(true); setStatus("Feedback saved on this device. You can edit or delete it here.");
    } catch { setStatus("Feedback could not be saved. Try again."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      await deleteFeedback(sessionId);
      setHelpfulness(""); setConfidence(""); setComment(""); setPreferredFormat("unchanged"); setSaved(false);
      setStatus("Feedback deleted from this device.");
    } catch { setStatus("Feedback could not be deleted. Try again."); }
    finally { setBusy(false); }
  };

  return <section className="section-card feedback-panel" id="section-feedback" data-section="feedback">
    <h2>How was your session?</h2>
    <p>Your feedback is optional. Confidence is your own assessment, not a comprehension score.</p>
    {!sessionId ? <p>End a learning session to leave feedback about that material.</p> :
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend>Did the adaptations help you understand the material?</legend>
          <div className="feedback-options">{([['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No']] as const).map(([value, label]) =>
            <label key={value}><input required type="radio" name="helpfulness" value={value} checked={helpfulness === value} onChange={() => setHelpfulness(value)} />{label}</label>)}</div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>How confident do you feel explaining the material?</legend>
          <div className="feedback-options">{([['low', 'Not yet confident'], ['medium', 'Somewhat confident'], ['high', 'Confident']] as const).map(([value, label]) =>
            <label key={value}><input required type="radio" name="confidence" value={value} checked={confidence === value} onChange={() => setConfidence(value)} />{label}</label>)}</div>
        </fieldset>
        <label className="feedback-field">What would you like to try next time?
          <select disabled={busy} value={preferredFormat} onChange={event => setPreferredFormat(event.target.value as SessionFeedback["preferredFormat"])}>
            <option value="unchanged">No preference change</option><option value="text">Structured text</option>
            <option value="visual">Visual explanation</option><option value="audio">Read aloud</option>
          </select>
        </label>
        <label className="feedback-field">What helped, or what should change? (optional)
          <textarea disabled={busy} value={comment} maxLength={2000} rows={3} onChange={event => setComment(event.target.value)} />
        </label>
        <p>This records feedback only. Automatic recommendation learning is not enabled yet.</p>
        <div className="feedback-actions"><button disabled={busy || !helpfulness || !confidence} type="submit">{busy ? "Please wait…" : saved ? "Update feedback" : "Save feedback"}</button>
          {saved && <button disabled={busy} type="button" onClick={remove}>Delete feedback</button>}</div>
      </form>}
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}
