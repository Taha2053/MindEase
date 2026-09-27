import { useState, useEffect, type FC } from "react";
import {
  loadApiKeys,
  saveApiKeys,
  testMistralKey,
  testPremiumServer,
} from "@/utils/apiKeyManager";
import {
  Key,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Server,
  Sparkles,
  ExternalLink,
  Loader2,
  Cpu,
} from "lucide-react";

export const ApiKeysSection: FC = () => {
  const [deepseekKey, setDeepseekKey] = useState("");
  const [mistralKey, setMistralKey] = useState("");
  const [napkinKey, setNapkinKey] = useState("");
  const [ocrKey, setOcrKey] = useState("");
  const [serverUrl, setServerUrl] = useState("http://localhost:8000");

  const [showDeepseek, setShowDeepseek] = useState(false);
  const [showMistral, setShowMistral] = useState(false);
  const [showNapkin, setShowNapkin] = useState(false);
  const [showOcr, setShowOcr] = useState(false);

  const [isTestingDeepseek, setIsTestingDeepseek] = useState(false);
  const [deepseekStatus, setDeepseekStatus] = useState<{ ok?: boolean; msg?: string } | null>(null);

  const [isTestingMistral, setIsTestingMistral] = useState(false);
  const [mistralStatus, setMistralStatus] = useState<{ ok?: boolean; msg?: string } | null>(null);

  const [isTestingServer, setIsTestingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<{ ok?: boolean; msg?: string } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    loadApiKeys().then((keys) => {
      setDeepseekKey(keys.deepseekApiKey || "");
      setMistralKey(keys.mistralApiKey || "");
      setNapkinKey(keys.napkinApiKey || "");
      setOcrKey(keys.ocrSpaceApiKey || "");
      setServerUrl(keys.premiumServerUrl || "http://localhost:8000");
    });
  }, []);

  const handleTestDeepseek = async () => {
    setIsTestingDeepseek(true);
    setDeepseekStatus(null);
    try {
      const resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deepseekKey.trim()}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
        }),
      });
      if (resp.ok) {
        setDeepseekStatus({ ok: true, msg: "DeepSeek API key is connected and working!" });
      } else {
        setDeepseekStatus({ ok: false, msg: `DeepSeek check failed (${resp.status}).` });
      }
    } catch (err) {
      setDeepseekStatus({ ok: false, msg: String(err) });
    } finally {
      setIsTestingDeepseek(false);
    }
  };

  const handleTestMistral = async () => {
    setIsTestingMistral(true);
    setMistralStatus(null);
    try {
      const result = await testMistralKey(mistralKey);
      if (result.ok) {
        setMistralStatus({ ok: true, msg: "Mistral API key is valid!" });
      } else {
        setMistralStatus({ ok: false, msg: result.error || "Invalid API key." });
      }
    } catch (err) {
      setMistralStatus({ ok: false, msg: String(err) });
    } finally {
      setIsTestingMistral(false);
    }
  };

  const handleTestServer = async () => {
    setIsTestingServer(true);
    setServerStatus(null);
    try {
      const result = await testPremiumServer(serverUrl);
      if (result.ok) {
        setServerStatus({ ok: true, msg: "Connected to MindEase video service!" });
      } else {
        setServerStatus({ ok: false, msg: result.error || "Cannot reach server." });
      }
    } catch (err) {
      setServerStatus({ ok: false, msg: String(err) });
    } finally {
      setIsTestingServer(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await saveApiKeys({
        deepseekApiKey: deepseekKey.trim(),
        mistralApiKey: mistralKey.trim(),
        napkinApiKey: napkinKey.trim(),
        ocrSpaceApiKey: ocrKey.trim(),
        premiumServerUrl: serverUrl.trim(),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      alert("Failed to save settings: " + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="section-card api-keys-panel">
      <div className="section-card-header">
        <Key size={18} />
        <div>
          <h2>API Keys &amp; AI Service Providers</h2>
          <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "var(--text-dim)" }}>
            DeepSeek is the primary intelligence engine for content structuring and Manim video generation. Mistral serves as an optional fallback.
          </p>
        </div>
      </div>

      <div className="api-keys-grid-content">
        {/* DeepSeek (Primary) */}
        <div className="api-key-block" style={{ border: "1.5px solid var(--accent)" }}>
          <div className="api-field-head">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label htmlFor="dash-deepseek-key">DeepSeek API Key</label>
              <span className="dest-req-badge" style={{ background: "var(--accent)", color: "var(--bg-base)" }}>Primary</span>
            </div>
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="api-help-link">
              <span>Get key</span>
              <ExternalLink size={11} />
            </a>
          </div>
          <div className="api-input-wrap">
            <input
              id="dash-deepseek-key"
              type={showDeepseek ? "text" : "password"}
              placeholder="sk-..."
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
            />
            <button
              type="button"
              className="api-eye-btn"
              onClick={() => setShowDeepseek(!showDeepseek)}
              aria-label={showDeepseek ? "Hide key" : "Show key"}
            >
              {showDeepseek ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="api-field-actions">
            <button
              type="button"
              className="btn-acc-tool"
              onClick={handleTestDeepseek}
              disabled={isTestingDeepseek || !deepseekKey.trim()}
            >
              {isTestingDeepseek ? <Loader2 size={12} className="spin" /> : <Cpu size={12} />}
              <span>Test DeepSeek</span>
            </button>
            {deepseekStatus && (
              <span className={`api-status-tag ${deepseekStatus.ok ? "success" : "error"}`}>
                {deepseekStatus.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {deepseekStatus.msg}
              </span>
            )}
          </div>
        </div>

        {/* Mistral (Fallback) */}
        <div className="api-key-block">
          <div className="api-field-head">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label htmlFor="dash-mistral-key">Mistral AI API Key</label>
              <span className="dest-req-badge" style={{ background: "var(--bg-base)", color: "var(--text-muted)" }}>Fallback</span>
            </div>
            <a href="https://console.mistral.ai/api-keys/" target="_blank" rel="noreferrer" className="api-help-link">
              <span>Get key</span>
              <ExternalLink size={11} />
            </a>
          </div>
          <div className="api-input-wrap">
            <input
              id="dash-mistral-key"
              type={showMistral ? "text" : "password"}
              placeholder="Optional fallback key"
              value={mistralKey}
              onChange={(e) => setMistralKey(e.target.value)}
            />
            <button
              type="button"
              className="api-eye-btn"
              onClick={() => setShowMistral(!showMistral)}
              aria-label={showMistral ? "Hide key" : "Show key"}
            >
              {showMistral ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="api-field-actions">
            <button
              type="button"
              className="btn-acc-tool"
              onClick={handleTestMistral}
              disabled={isTestingMistral || !mistralKey.trim()}
            >
              {isTestingMistral ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
              <span>Test Key</span>
            </button>
            {mistralStatus && (
              <span className={`api-status-tag ${mistralStatus.ok ? "success" : "error"}`}>
                {mistralStatus.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {mistralStatus.msg}
              </span>
            )}
          </div>
        </div>

        {/* Napkin AI */}
        <div className="api-key-block">
          <div className="api-field-head">
            <label htmlFor="dash-napkin-key">Napkin AI API Key (Visual Diagrams)</label>
            <a href="https://napkin.ai" target="_blank" rel="noreferrer" className="api-help-link">
              <span>napkin.ai</span>
              <ExternalLink size={11} />
            </a>
          </div>
          <div className="api-input-wrap">
            <input
              id="dash-napkin-key"
              type={showNapkin ? "text" : "password"}
              placeholder="Optional Napkin API key"
              value={napkinKey}
              onChange={(e) => setNapkinKey(e.target.value)}
            />
            <button
              type="button"
              className="api-eye-btn"
              onClick={() => setShowNapkin(!showNapkin)}
              aria-label={showNapkin ? "Hide key" : "Show key"}
            >
              {showNapkin ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* OCR.space */}
        <div className="api-key-block">
          <div className="api-field-head">
            <label htmlFor="dash-ocr-key">OCR.space API Key (Image Text)</label>
            <a href="https://ocr.space/ocrapi/freekey" target="_blank" rel="noreferrer" className="api-help-link">
              <span>Free key</span>
              <ExternalLink size={11} />
            </a>
          </div>
          <div className="api-input-wrap">
            <input
              id="dash-ocr-key"
              type={showOcr ? "text" : "password"}
              placeholder="Optional OCR.space key"
              value={ocrKey}
              onChange={(e) => setOcrKey(e.target.value)}
            />
            <button
              type="button"
              className="api-eye-btn"
              onClick={() => setShowOcr(!showOcr)}
              aria-label={showOcr ? "Hide key" : "Show key"}
            >
              {showOcr ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Premium Service URL */}
        <div className="api-key-block">
          <div className="api-field-head">
            <label htmlFor="dash-server-url">Video Generation Service URL</label>
          </div>
          <div className="api-input-wrap">
            <input
              id="dash-server-url"
              type="text"
              placeholder="http://localhost:8000"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
          </div>
          <div className="api-field-actions">
            <button
              type="button"
              className="btn-acc-tool"
              onClick={handleTestServer}
              disabled={isTestingServer || !serverUrl.trim()}
            >
              {isTestingServer ? <Loader2 size={12} className="spin" /> : <Server size={12} />}
              <span>Ping Server</span>
            </button>
            {serverStatus && (
              <span className={`api-status-tag ${serverStatus.ok ? "success" : "error"}`}>
                {serverStatus.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {serverStatus.msg}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button
          type="button"
          className={`btn-acc-primary ${saveSuccess ? "saved" : ""}`}
          onClick={handleSave}
          disabled={isSaving}
          style={{ minWidth: 160 }}
        >
          {saveSuccess ? (
            <>
              <CheckCircle2 size={14} /> Saved!
            </>
          ) : isSaving ? (
            "Saving..."
          ) : (
            <>
              <Sparkles size={14} /> Save &amp; Apply Keys
            </>
          )}
        </button>
      </div>
    </div>
  );
};
