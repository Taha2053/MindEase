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
  X,
  Loader2,
} from "lucide-react";

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeysSaved?: () => void;
}

export const ApiKeyModal: FC<ApiKeyModalProps> = ({ isOpen, onClose, onKeysSaved }) => {
  const [mistralKey, setMistralKey] = useState("");
  const [napkinKey, setNapkinKey] = useState("");
  const [ocrKey, setOcrKey] = useState("");
  const [serverUrl, setServerUrl] = useState("http://localhost:8000");

  const [showMistral, setShowMistral] = useState(false);
  const [showNapkin, setShowNapkin] = useState(false);
  const [showOcr, setShowOcr] = useState(false);

  const [isTestingMistral, setIsTestingMistral] = useState(false);
  const [mistralStatus, setMistralStatus] = useState<{ ok?: boolean; msg?: string } | null>(null);

  const [isTestingServer, setIsTestingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<{ ok?: boolean; msg?: string } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadApiKeys().then((keys) => {
        setMistralKey(keys.mistralApiKey || "");
        setNapkinKey(keys.napkinApiKey || "");
        setOcrKey(keys.ocrSpaceApiKey || "");
        setServerUrl(keys.premiumServerUrl || "http://localhost:8000");
        setMistralStatus(null);
        setServerStatus(null);
        setSaveSuccess(false);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestMistral = async () => {
    setIsTestingMistral(true);
    setMistralStatus(null);
    try {
      const result = await testMistralKey(mistralKey);
      if (result.ok) {
        setMistralStatus({ ok: true, msg: "Connected! Mistral API key is valid." });
      } else {
        setMistralStatus({ ok: false, msg: result.error || "Failed to validate key." });
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
        setServerStatus({ ok: true, msg: "Connected to MindEase Premium service!" });
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
        mistralApiKey: mistralKey.trim(),
        napkinApiKey: napkinKey.trim(),
        ocrSpaceApiKey: ocrKey.trim(),
        premiumServerUrl: serverUrl.trim(),
      });
      setSaveSuccess(true);
      if (onKeysSaved) onKeysSaved();
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 900);
    } catch (err) {
      alert("Failed to save settings: " + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="api-modal-overlay" onClick={onClose}>
      <div className="api-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="api-modal-header">
          <div className="api-modal-title">
            <Key size={18} className="text-accent" />
            <span>API Keys & Services</span>
          </div>
          <button className="api-modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="api-modal-body">
          <p className="api-modal-subtitle">
            Configure your free or custom API keys. Keys are saved locally in your browser so you never need to rebuild or touch a .env file.
          </p>

          {/* ── Section: Mistral AI ── */}
          <div className="api-input-group">
            <div className="api-label-row">
              <label htmlFor="mistral-key" className="api-label required">
                Mistral AI API Key <span>(Required for AI restructuring)</span>
              </label>
              <a
                href="https://console.mistral.ai/"
                target="_blank"
                rel="noreferrer"
                className="api-help-link"
              >
                Get Free Key <ExternalLink size={10} />
              </a>
            </div>
            <div className="api-field-wrap">
              <input
                id="mistral-key"
                type={showMistral ? "text" : "password"}
                className="api-input"
                placeholder="Paste your Mistral API key (starts with '...')"
                value={mistralKey}
                onChange={(e) => {
                  setMistralKey(e.target.value);
                  setMistralStatus(null);
                }}
              />
              <button
                type="button"
                className="api-eye-btn"
                onClick={() => setShowMistral(!showMistral)}
                aria-label="Toggle password visibility"
              >
                {showMistral ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="api-action-row">
              <button
                type="button"
                className="api-test-btn"
                onClick={handleTestMistral}
                disabled={isTestingMistral || !mistralKey.trim()}
              >
                {isTestingMistral ? (
                  <>
                    <Loader2 size={12} className="spin" /> Testing...
                  </>
                ) : (
                  "Test Connection"
                )}
              </button>
              {mistralStatus && (
                <span className={`api-status-tag ${mistralStatus.ok ? "success" : "error"}`}>
                  {mistralStatus.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  {mistralStatus.msg}
                </span>
              )}
            </div>
          </div>

          {/* ── Section: Visual Providers (Optional) ── */}
          <div className="api-divider">
            <span>Visual Anchors & OCR (Optional)</span>
          </div>

          {/* Napkin AI */}
          <div className="api-input-group">
            <div className="api-label-row">
              <label htmlFor="napkin-key" className="api-label">
                Napkin AI Key <span>(Flowcharts & mindmaps)</span>
              </label>
              <a
                href="https://www.napkin.ai/"
                target="_blank"
                rel="noreferrer"
                className="api-help-link"
              >
                Napkin.ai <ExternalLink size={10} />
              </a>
            </div>
            <div className="api-field-wrap">
              <input
                id="napkin-key"
                type={showNapkin ? "text" : "password"}
                className="api-input"
                placeholder="Optional Napkin API key"
                value={napkinKey}
                onChange={(e) => setNapkinKey(e.target.value)}
              />
              <button
                type="button"
                className="api-eye-btn"
                onClick={() => setShowNapkin(!showNapkin)}
              >
                {showNapkin ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* OCR.space Key */}
          <div className="api-input-group">
            <div className="api-label-row">
              <label htmlFor="ocr-key" className="api-label">
                OCR.space Key <span>(Extract text from images)</span>
              </label>
              <a
                href="https://ocr.space/ocrapi/freekey"
                target="_blank"
                rel="noreferrer"
                className="api-help-link"
              >
                Free Key <ExternalLink size={10} />
              </a>
            </div>
            <div className="api-field-wrap">
              <input
                id="ocr-key"
                type={showOcr ? "text" : "password"}
                className="api-input"
                placeholder="Optional OCR.space key"
                value={ocrKey}
                onChange={(e) => setOcrKey(e.target.value)}
              />
              <button
                type="button"
                className="api-eye-btn"
                onClick={() => setShowOcr(!showOcr)}
              >
                {showOcr ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* ── Section: Premium Backend Service ── */}
          <div className="api-divider">
            <span>MindEase Processing Server</span>
          </div>

          <div className="api-input-group">
            <div className="api-label-row">
              <label htmlFor="server-url" className="api-label">
                Backend Server URL <span>(FastAPI + Python 3.13 Manim pipeline)</span>
              </label>
            </div>
            <div className="api-field-wrap">
              <input
                id="server-url"
                type="text"
                className="api-input font-mono"
                placeholder="http://localhost:8000"
                value={serverUrl}
                onChange={(e) => {
                  setServerUrl(e.target.value);
                  setServerStatus(null);
                }}
              />
            </div>
            <div className="api-action-row">
              <button
                type="button"
                className="api-test-btn"
                onClick={handleTestServer}
                disabled={isTestingServer || !serverUrl.trim()}
              >
                {isTestingServer ? (
                  <>
                    <Loader2 size={12} className="spin" /> Checking...
                  </>
                ) : (
                  <>
                    <Server size={12} /> Ping Service
                  </>
                )}
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

        <div className="api-modal-footer">
          <button type="button" className="api-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`api-save-btn ${saveSuccess ? "saved" : ""}`}
            onClick={handleSave}
            disabled={isSaving}
          >
            {saveSuccess ? (
              <>
                <CheckCircle2 size={14} /> Saved!
              </>
            ) : isSaving ? (
              "Saving..."
            ) : (
              <>
                <Sparkles size={14} /> Save & Apply Keys
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
