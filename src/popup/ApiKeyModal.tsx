import { useState, useEffect, type FC } from "react";
import { StorageDestinationSelector } from "@/session/dashboard/StorageDestinationSelector";
import {
  loadApiKeys,
  saveApiKeys,
  testMistralKey,
  testPremiumServer,
} from "@/utils/apiKeyManager";
import {
  Settings,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Server,
  Sparkles,
  ExternalLink,
  X,
  Loader2,
  Cpu,
  FolderCheck,
} from "lucide-react";

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeysSaved?: () => void;
}

export const ApiKeyModal: FC<ApiKeyModalProps> = ({ isOpen, onClose, onKeysSaved }) => {
  const [activeTab, setActiveTab] = useState<"storage" | "ai">("storage");

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
    if (isOpen) {
      loadApiKeys().then((keys) => {
        setDeepseekKey(keys.deepseekApiKey || "");
        setMistralKey(keys.mistralApiKey || "");
        setNapkinKey(keys.napkinApiKey || "");
        setOcrKey(keys.ocrSpaceApiKey || "");
        setServerUrl(keys.premiumServerUrl || "http://localhost:8000");
        setDeepseekStatus(null);
        setMistralStatus(null);
        setServerStatus(null);
        setSaveSuccess(false);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

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
        setDeepseekStatus({ ok: true, msg: "Connected successfully!" });
      } else {
        setDeepseekStatus({ ok: false, msg: `Failed (${resp.status})` });
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
        setMistralStatus({ ok: true, msg: "Valid key!" });
      } else {
        setMistralStatus({ ok: false, msg: result.error || "Invalid key" });
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
        setServerStatus({ ok: true, msg: "Connected!" });
      } else {
        setServerStatus({ ok: false, msg: result.error || "Unreachable" });
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
        {/* Header */}
        <div className="api-modal-header">
          <div className="api-modal-title">
            <Settings size={18} className="text-accent" />
            <span>Preferences &amp; Providers</span>
          </div>
          <button className="api-modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Tab navigation pills */}
        <div className="modal-tab-pills">
          <button
            type="button"
            className={`modal-pill-btn ${activeTab === "storage" ? "active" : ""}`}
            onClick={() => setActiveTab("storage")}
          >
            <FolderCheck size={13} />
            <span>Storage &amp; Archive</span>
          </button>
          <button
            type="button"
            className={`modal-pill-btn ${activeTab === "ai" ? "active" : ""}`}
            onClick={() => setActiveTab("ai")}
          >
            <Cpu size={13} />
            <span>AI Provider Keys</span>
          </button>
        </div>

        <div className="api-modal-body">
          {activeTab === "storage" ? (
            <div className="modal-tab-pane">
              <StorageDestinationSelector compact />
            </div>
          ) : (
            <div className="modal-tab-pane">
              {/* DeepSeek */}
              <div className="modal-setting-card">
                <div className="modal-setting-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="setting-label">DeepSeek API Key</span>
                    <span className="dest-req-badge">Primary AI</span>
                  </div>
                  <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="api-help-link">
                    <span>Get key</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
                <div className="api-field-wrap">
                  <input
                    type={showDeepseek ? "text" : "password"}
                    className="api-input"
                    placeholder="Enter custom key (or leave empty to use server default)"
                    value={deepseekKey}
                    onChange={(e) => setDeepseekKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="api-eye-btn"
                    onClick={() => setShowDeepseek(!showDeepseek)}
                    aria-label={showDeepseek ? "Hide" : "Show"}
                  >
                    {showDeepseek ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div className="api-action-row">
                  <button
                    type="button"
                    className="api-test-btn"
                    onClick={handleTestDeepseek}
                    disabled={isTestingDeepseek || !deepseekKey.trim()}
                  >
                    {isTestingDeepseek ? <Loader2 size={11} className="spin" /> : <Cpu size={11} />}
                    <span>Test Key</span>
                  </button>
                  {deepseekStatus && (
                    <span className={`api-status-tag ${deepseekStatus.ok ? "success" : "error"}`}>
                      {deepseekStatus.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                      {deepseekStatus.msg}
                    </span>
                  )}
                </div>
              </div>

              {/* Mistral */}
              <div className="modal-setting-card">
                <div className="modal-setting-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="setting-label">Mistral AI Key</span>
                    <span className="dest-sub-badge">Fallback</span>
                  </div>
                  <a href="https://console.mistral.ai/api-keys/" target="_blank" rel="noreferrer" className="api-help-link">
                    <span>Get key</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
                <div className="api-field-wrap">
                  <input
                    type={showMistral ? "text" : "password"}
                    className="api-input"
                    placeholder="Optional fallback key"
                    value={mistralKey}
                    onChange={(e) => setMistralKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="api-eye-btn"
                    onClick={() => setShowMistral(!showMistral)}
                    aria-label={showMistral ? "Hide" : "Show"}
                  >
                    {showMistral ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div className="api-action-row">
                  <button
                    type="button"
                    className="api-test-btn"
                    onClick={handleTestMistral}
                    disabled={isTestingMistral || !mistralKey.trim()}
                  >
                    {isTestingMistral ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
                    <span>Test Key</span>
                  </button>
                  {mistralStatus && (
                    <span className={`api-status-tag ${mistralStatus.ok ? "success" : "error"}`}>
                      {mistralStatus.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                      {mistralStatus.msg}
                    </span>
                  )}
                </div>
              </div>

              {/* Napkin AI */}
              <div className="modal-setting-card">
                <div className="modal-setting-header">
                  <span className="setting-label">Napkin AI Key (Visuals)</span>
                  <a href="https://napkin.ai" target="_blank" rel="noreferrer" className="api-help-link">
                    <span>napkin.ai</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
                <div className="api-field-wrap">
                  <input
                    type={showNapkin ? "text" : "password"}
                    className="api-input"
                    placeholder="Optional Napkin key"
                    value={napkinKey}
                    onChange={(e) => setNapkinKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="api-eye-btn"
                    onClick={() => setShowNapkin(!showNapkin)}
                    aria-label={showNapkin ? "Hide" : "Show"}
                  >
                    {showNapkin ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>

              {/* OCR.space */}
              <div className="modal-setting-card">
                <div className="modal-setting-header">
                  <span className="setting-label">OCR.space Key (Image Text)</span>
                  <a href="https://ocr.space/ocrapi/freekey" target="_blank" rel="noreferrer" className="api-help-link">
                    <span>Free key</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
                <div className="api-field-wrap">
                  <input
                    type={showOcr ? "text" : "password"}
                    className="api-input"
                    placeholder="Optional OCR key"
                    value={ocrKey}
                    onChange={(e) => setOcrKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="api-eye-btn"
                    onClick={() => setShowOcr(!showOcr)}
                    aria-label={showOcr ? "Hide" : "Show"}
                  >
                    {showOcr ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>

              {/* Video Service URL */}
              <div className="modal-setting-card">
                <div className="modal-setting-header">
                  <span className="setting-label">Video Service URL</span>
                </div>
                <div className="api-field-wrap">
                  <input
                    type="text"
                    className="api-input"
                    placeholder="http://localhost:8000"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                  />
                </div>
                <div className="api-action-row">
                  <button
                    type="button"
                    className="api-test-btn"
                    onClick={handleTestServer}
                    disabled={isTestingServer || !serverUrl.trim()}
                  >
                    {isTestingServer ? <Loader2 size={11} className="spin" /> : <Server size={11} />}
                    <span>Ping</span>
                  </button>
                  {serverStatus && (
                    <span className={`api-status-tag ${serverStatus.ok ? "success" : "error"}`}>
                      {serverStatus.ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                      {serverStatus.msg}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
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
                <CheckCircle2 size={13} /> Saved!
              </>
            ) : isSaving ? (
              "Saving..."
            ) : (
              <>
                <Sparkles size={13} /> Save Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
