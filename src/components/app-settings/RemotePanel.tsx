import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useI18n } from "../../i18n";
import { writeClipboardText } from "../file-explorer/clipboard";
import s from "../../styles";

const STORAGE_KEY = "nezha_remote_cfg";

interface RemoteConfig {
  port: string;
  appId: string;
  appSecret: string;
}

function loadStored(): RemoteConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { appId: "", appSecret: "", port: "9877", ...JSON.parse(raw) };
  } catch {}
  return { port: "9877", appId: "", appSecret: "" };
}

export function RemotePanel() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<RemoteConfig>(loadStored);
  const [serverPort, setServerPort] = useState(0);
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<number>("get_remote_server_port")
      .then(setServerPort)
      .catch(() => {});
    invoke<string>("get_remote_token")
      .then(setAccessToken)
      .catch(() => {});
  }, []);

  const accessUrl =
    serverPort > 0 && accessToken
      ? `http://localhost:${serverPort}/?token=${accessToken}`
      : "";

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 5,
    display: "block",
  };

  const fieldStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  };

  const hintStyle: React.CSSProperties = {
    fontSize: 11,
    color: "var(--text-hint)",
    marginTop: 3,
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--input-bg, var(--bg-secondary))",
    border: "1px solid var(--border-light)",
    borderRadius: 6,
    color: "var(--text-primary)",
    fontSize: 13,
    padding: "6px 10px",
    outline: "none",
    width: 260,
    boxSizing: "border-box",
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-hint)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: 12,
    marginTop: 4,
  };

  function handleChange(key: keyof RemoteConfig, value: string) {
    setCfg((prev) => {
      const next = { ...prev, [key]: value };
      try {
        // don't persist appSecret to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, appSecret: "" }));
      } catch {}
      return next;
    });
  }

  async function handleSave() {
    const port = parseInt(cfg.port, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      setError(t("appSettings.remote.portInvalid"));
      return;
    }
    setError("");
    setSaving(true);
    try {
      await invoke("configure_feishu_bot", {
        appId: cfg.appId.trim(),
        appSecret: cfg.appSecret.trim(),
        port,
      });
      setServerPort(port);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function openPanel() {
    const port = serverPort || parseInt(cfg.port, 10) || 9877;
    const url = accessToken
      ? `http://localhost:${port}/?token=${accessToken}`
      : `http://localhost:${port}`;
    window.open(url, "_blank");
  }

  async function copyAccessUrl() {
    if (!accessUrl) return;
    try {
      await writeClipboardText(accessUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      style={{
        ...s.settingsBody,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        padding: "20px",
      }}
    >
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 7,
          background: serverPort > 0 ? "var(--bg-secondary)" : "var(--bg-secondary)",
          border: "1px solid var(--border-light)",
          marginBottom: 20,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            flexShrink: 0,
            background: serverPort > 0 ? "#4caf50" : "var(--text-hint)",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {serverPort > 0
            ? t("appSettings.remote.running", { port: String(serverPort) })
            : t("appSettings.remote.stopped")}
        </span>
        {serverPort > 0 && (
          <button
            type="button"
            onClick={openPanel}
            title={t("appSettings.remote.openPanel")}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-hint)",
              padding: 2,
              display: "flex",
              alignItems: "center",
            }}
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>

      {/* Access link (with token) */}
      {accessUrl && (
        <>
          <p style={sectionTitleStyle}>{t("appSettings.remote.accessSection")}</p>
          <div style={{ ...fieldStyle, marginBottom: 22 }}>
            <label style={labelStyle}>{t("appSettings.remote.accessLink")}</label>
            <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
              <input
                type="text"
                readOnly
                value={accessUrl}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  ...inputStyle,
                  width: 320,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                onClick={copyAccessUrl}
                title={t("appSettings.remote.copy")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "0 12px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-light)",
                  borderRadius: 6,
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}
                {copied ? t("appSettings.remote.copied") : t("appSettings.remote.copy")}
              </button>
            </div>
            <span style={hintStyle}>{t("appSettings.remote.accessHint")}</span>
          </div>
        </>
      )}

      {/* HTTP server port */}
      <p style={sectionTitleStyle}>{t("appSettings.remote.serverSection")}</p>
      <div style={fieldStyle}>
        <label style={labelStyle}>{t("appSettings.remote.port")}</label>
        <input
          type="number"
          min={1024}
          max={65535}
          value={cfg.port}
          onChange={(e) => handleChange("port", e.target.value)}
          style={inputStyle}
        />
        <span style={hintStyle}>{t("appSettings.remote.portHint")}</span>
      </div>

      {/* Feishu credentials */}
      <p style={{ ...sectionTitleStyle, marginTop: 22 }}>{t("appSettings.remote.feishuSection")}</p>
      <div style={{ ...fieldStyle, marginTop: 0 }}>
        <label style={labelStyle}>{t("appSettings.remote.appId")}</label>
        <input
          type="text"
          placeholder="cli_xxxxxxxxxxxxxxxx"
          value={cfg.appId}
          onChange={(e) => handleChange("appId", e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ ...fieldStyle, marginTop: 14 }}>
        <label style={labelStyle}>{t("appSettings.remote.appSecret")}</label>
        <input
          type="password"
          placeholder="••••••••••••••••"
          value={cfg.appSecret}
          onChange={(e) => handleChange("appSecret", e.target.value)}
          style={inputStyle}
        />
        <span style={hintStyle}>{t("appSettings.remote.feishuHint")}</span>
      </div>

      {/* Error */}
      {error && (
        <p style={{ fontSize: 12, color: "var(--error-text, #e53935)", marginTop: 10 }}>{error}</p>
      )}

      {/* Save button */}
      <div style={{ marginTop: 20 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            ...s.primaryActionBtn,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minWidth: 90,
          }}
        >
          {saved ? (
            <>
              <Check size={13} strokeWidth={2.5} />
              {t("appSettings.remote.saved")}
            </>
          ) : saving ? (
            t("appSettings.remote.saving")
          ) : (
            t("appSettings.remote.save")
          )}
        </button>
      </div>
    </div>
  );
}
