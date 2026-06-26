import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Bot,
  Ticket,
  CreditCard,
  Copy,
  Bitcoin,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WizardRenderProps {
  currentStep: number;
  goToStep: (step: number) => void;
  data: Record<string, unknown>;
  setData: (key: string, value: unknown) => void;
}

export interface WizardModalProps {
  open: boolean;
  onClose: () => void;
  renderStep: (props: WizardRenderProps) => React.ReactNode;
  stepCount: number;
  stepLabels?: string[];
  onComplete: (data: Record<string, unknown>) => void;
  title: string;
  accentColor?: string;
}

// ─── Base WizardModal ─────────────────────────────────────────────────────────

export function WizardModal({
  open,
  onClose,
  renderStep,
  stepCount,
  stepLabels,
  onComplete,
  title,
  accentColor = "var(--dash-accent, #8b5cf6)",
}: WizardModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCurrentStep(0);
      setData({});
      setValidationError(null);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setCurrentStep(0);
    setData({});
    setValidationError(null);
    onClose();
  }, [onClose]);

  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step < stepCount) {
      setCurrentStep(step);
      setValidationError(null);
    }
  }, [stepCount]);

  const handleNext = useCallback(() => {
    if (currentStep < stepCount - 1) {
      setCurrentStep((s) => s + 1);
      setValidationError(null);
    }
  }, [currentStep, stepCount]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
      setValidationError(null);
    }
  }, [currentStep]);

  const handleFinish = useCallback(() => {
    onComplete(data);
    handleClose();
  }, [data, onComplete, handleClose]);

  const setStepData = useCallback((key: string, value: unknown) => {
    setData((prev) => ({ ...prev, [key]: value }));
    setValidationError(null);
  }, []);

  if (!open) return null;

  const renderProps: WizardRenderProps = {
    currentStep,
    goToStep,
    data,
    setData: setStepData,
  };

  return createPortal(
    <div
      className="r-wizard-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="r-wizard-modal"
        style={{
          background: "var(--dash-modal-bg, #0f1117)",
          border: "1px solid var(--dash-modal-border, #1e2230)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "560px",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 0",
            borderBottom: "1px solid var(--dash-modal-border, #1e2230)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "20px",
            }}
          >
            <h2
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--dash-text, #e2e8f0)",
                margin: 0,
              }}
            >
              {title}
            </h2>
            <button
              onClick={handleClose}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--dash-text-muted, #64748b)",
                padding: "4px",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--dash-text, #e2e8f0)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--dash-text-muted, #64748b)";
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Progress stepper */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              paddingBottom: "20px",
              position: "relative",
            }}
          >
            {/* Connector lines (behind dots) */}
            <div
              style={{
                position: "absolute",
                top: "14px",
                left: "calc(14px + 16px)",
                right: "calc(14px + 16px)",
                height: "2px",
                background: "var(--dash-modal-border, #1e2230)",
                borderRadius: "1px",
                zIndex: 0,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "14px",
                left: "calc(14px + 16px)",
                height: "2px",
                borderRadius: "1px",
                zIndex: 1,
                background: accentColor,
                transition: "width 0.3s ease",
                width: `${stepCount > 1 ? (currentStep / (stepCount - 1)) * (100 - 32 / stepCount * 0) : 0}%`,
                maxWidth: `calc(${100}% - 32px)`,
              }}
            />

            {Array.from({ length: stepCount }).map((_, i) => {
              const isDone = i < currentStep;
              const isActive = i === currentStep;
              const isPending = i > currentStep;
              const label = stepLabels?.[i];

              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "6px",
                    zIndex: 2,
                    flex: "1 1 0",
                  }}
                >
                  <div
                    className={`r-wizard-step-dot ${isDone ? "done" : ""} ${isActive ? "active" : ""}`}
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      fontWeight: 600,
                      transition: "all 0.3s ease",
                      ...(isDone && {
                        background: accentColor,
                        border: `2px solid ${accentColor}`,
                        color: "#fff",
                        boxShadow: `0 0 12px ${accentColor}40`,
                      }),
                      ...(isActive && {
                        background: "var(--dash-modal-bg, #0f1117)",
                        border: `2px solid ${accentColor}`,
                        color: accentColor,
                        boxShadow: `0 0 0 4px ${accentColor}25, 0 0 16px ${accentColor}50`,
                      }),
                      ...(isPending && {
                        background: "var(--dash-modal-bg, #0f1117)",
                        border: "2px solid var(--dash-modal-border, #1e2230)",
                        color: "var(--dash-text-muted, #64748b)",
                      }),
                    }}
                  >
                    {isDone ? (
                      <Check size={14} strokeWidth={3} />
                    ) : (
                      <span>{i + 1}</span>
                    )}
                  </div>
                  {label && (
                    <span
                      className="r-wizard-step"
                      style={{
                        fontSize: "10px",
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? accentColor : isDone ? "var(--dash-text, #e2e8f0)" : "var(--dash-text-muted, #64748b)",
                        textAlign: "center",
                        maxWidth: "64px",
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          {renderStep(renderProps)}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--dash-modal-border, #1e2230)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <button
            className="r-btn r-btn-outline"
            onClick={handleBack}
            disabled={currentStep === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: currentStep === 0 ? "not-allowed" : "pointer",
              opacity: currentStep === 0 ? 0.4 : 1,
              transition: "all 0.2s",
              background: "transparent",
              border: "1px solid var(--dash-modal-border, #1e2230)",
              color: "var(--dash-text, #e2e8f0)",
            }}
            onMouseEnter={(e) => {
              if (currentStep > 0) {
                e.currentTarget.style.borderColor = accentColor;
                e.currentTarget.style.color = accentColor;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)";
              e.currentTarget.style.color = "var(--dash-text, #e2e8f0)";
            }}
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {validationError && (
              <span
                style={{
                  fontSize: "12px",
                  color: "#ef4444",
                  maxWidth: "200px",
                  textAlign: "right",
                }}
              >
                {validationError}
              </span>
            )}

            {currentStep < stepCount - 1 ? (
              <button
                className="r-btn r-btn-primary"
                onClick={handleNext}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 20px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  background: accentColor,
                  border: "none",
                  color: "#fff",
                  boxShadow: `0 0 16px ${accentColor}30`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 24px ${accentColor}60`;
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 16px ${accentColor}30`;
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                className="r-btn r-btn-primary"
                onClick={handleFinish}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 20px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  background: accentColor,
                  border: "none",
                  color: "#fff",
                  boxShadow: `0 0 16px ${accentColor}30`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 24px ${accentColor}60`;
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 16px ${accentColor}30`;
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <Check size={16} />
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── CreateBotWizard ──────────────────────────────────────────────────────────

interface CreateBotWizardProps {
  open: boolean;
  onClose: () => void;
  onCreateBot: (data: CreateBotData) => void;
}

export interface CreateBotData {
  name: string;
  host: string;
  port: string;
  username: string;
  authMode: "offline" | "microsoft" | "ssid";
}

export function CreateBotWizard({ open, onClose, onCreateBot }: CreateBotWizardProps) {
  const [botName, setBotName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("25565");
  const [username, setUsername] = useState("");
  const [authMode, setAuthMode] = useState<"offline" | "microsoft" | "ssid" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setBotName("");
    setHost("");
    setPort("25565");
    setUsername("");
    setAuthMode(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const renderStep = useCallback(
    ({ currentStep, setData }: WizardRenderProps) => {
      const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "10px 14px",
        borderRadius: "8px",
        border: "1px solid var(--dash-modal-border, #1e2230)",
        background: "var(--dash-modal-input-bg, #16181f)",
        color: "var(--dash-text, #e2e8f0)",
        fontSize: "14px",
        outline: "none",
        transition: "border-color 0.2s",
        boxSizing: "border-box",
      };

      const labelStyle: React.CSSProperties = {
        display: "block",
        fontSize: "12px",
        fontWeight: 600,
        color: "var(--dash-text-muted, #64748b)",
        marginBottom: "6px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      };

      const cardBase: React.CSSProperties = {
        padding: "16px",
        borderRadius: "10px",
        border: "1px solid var(--dash-modal-border, #1e2230)",
        background: "var(--dash-modal-input-bg, #16181f)",
        cursor: "pointer",
        transition: "all 0.2s",
        textAlign: "center",
      };

      switch (currentStep) {
        case 0:
          return (
            <div>
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Bot Name</label>
                <input
                  className="r-input"
                  type="text"
                  placeholder="MyAwesomeBot"
                  value={botName}
                  onChange={(e) => {
                    setBotName(e.target.value);
                    setError(null);
                    setData("botName", e.target.value);
                  }}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--dash-accent, #8b5cf6)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)"; }}
                />
              </div>
              <p style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)", marginTop: "8px" }}>
                Choose a unique name for your bot. This will be its display identifier.
              </p>
            </div>
          );

        case 1:
          return (
            <div>
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Server Host</label>
                <input
                  className="r-input"
                  type="text"
                  placeholder="play.example.com"
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value);
                    setError(null);
                    setData("host", e.target.value);
                  }}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--dash-accent, #8b5cf6)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)"; }}
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Port</label>
                <input
                  className="r-input"
                  type="text"
                  placeholder="25565"
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value);
                    setData("port", e.target.value);
                  }}
                  style={{ ...inputStyle, width: "120px" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--dash-accent, #8b5cf6)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)"; }}
                />
              </div>
              <p style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)", marginTop: "8px" }}>
                Enter your Minecraft server address and port. Default is 25565.
              </p>
            </div>
          );

        case 2:
          return (
            <div>
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Minecraft Username</label>
                <input
                  className="r-input"
                  type="text"
                  placeholder="Steve"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError(null);
                    setData("username", e.target.value);
                  }}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--dash-accent, #8b5cf6)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)"; }}
                />
              </div>
              <p style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)", marginTop: "8px" }}>
                The Minecraft username this bot will use to join the server.
              </p>
            </div>
          );

        case 3:
          const modes: Array<{ value: "offline" | "microsoft" | "ssid"; label: string; desc: string }> = [
            { value: "offline", label: "Offline", desc: "No auth, username only" },
            { value: "microsoft", label: "Microsoft", desc: "Xbox Live login" },
            { value: "ssid", label: "SSID", desc: "Session ID auth" },
          ];
          return (
            <div>
              <p style={{ fontSize: "13px", color: "var(--dash-text-muted, #64748b)", marginBottom: "16px" }}>
                Select the authentication method for this bot.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {modes.map((mode) => (
                  <div
                    key={mode.value}
                    onClick={() => {
                      setAuthMode(mode.value);
                      setError(null);
                      setData("authMode", mode.value);
                    }}
                    style={{
                      ...cardBase,
                      borderColor: authMode === mode.value ? "var(--dash-accent, #8b5cf6)" : "var(--dash-modal-border, #1e2230)",
                      background: authMode === mode.value ? "rgba(139, 92, 246, 0.08)" : "var(--dash-modal-input-bg, #16181f)",
                      boxShadow: authMode === mode.value ? "0 0 12px rgba(139, 92, 246, 0.2)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (authMode !== mode.value) {
                        e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.4)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (authMode !== mode.value) {
                        e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)";
                      }
                    }}
                  >
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--dash-text, #e2e8f0)", marginBottom: "4px" }}>
                      {mode.label}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)" }}>
                      {mode.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );

        case 4:
          return (
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--dash-text, #e2e8f0)", marginBottom: "16px" }}>
                Review your bot configuration
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { label: "Name", value: botName || "—" },
                  { label: "Host", value: host || "—" },
                  { label: "Port", value: port || "—" },
                  { label: "Username", value: username || "—" },
                  { label: "Auth Mode", value: authMode ? authMode.charAt(0).toUpperCase() + authMode.slice(1) : "—" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      background: "var(--dash-modal-input-bg, #16181f)",
                      border: "1px solid var(--dash-modal-border, #1e2230)",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)" }}>{item.label}</span>
                    <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--dash-text, #e2e8f0)" }}>{item.value}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)", marginTop: "16px" }}>
                Click "Create Bot" to add this bot to your dashboard.
              </p>
            </div>
          );

        default:
          return null;
      }
    },
    [botName, host, port, username, authMode]
  );

  const validateStep = useCallback(
    ({ currentStep }: WizardRenderProps) => {
      switch (currentStep) {
        case 0:
          if (!botName.trim()) { setError("Bot name is required"); return false; }
          break;
        case 1:
          if (!host.trim()) { setError("Server host is required"); return false; }
          break;
        case 2:
          if (!username.trim()) { setError("Username is required"); return false; }
          break;
        case 3:
          if (!authMode) { setError("Please select an auth mode"); return false; }
          break;
      }
      setError(null);
      return true;
    },
    [botName, host, username, authMode]
  );

  const handleComplete = useCallback(
    (allData: Record<string, unknown>) => {
      onCreateBot({
        name: botName,
        host,
        port,
        username,
        authMode: authMode!,
      });
    },
    [botName, host, port, username, authMode, onCreateBot]
  );

  return (
    <WizardModal
      open={open}
      onClose={onClose}
      title="Create New Bot"
      stepCount={5}
      stepLabels={["Name", "Server", "Username", "Auth", "Review"]}
      renderStep={(props) => {
        const valid = validateStep(props);
        return renderStep(props);
      }}
      onComplete={handleComplete}
      accentColor="var(--dash-accent, #8b5cf6)"
    />
  );
}

// ─── CreateTicketWizard ────────────────────────────────────────────────────────

interface CreateTicketWizardProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTicketData) => void;
}

export interface CreateTicketData {
  subject: string;
  priority: "low" | "medium" | "high";
  message: string;
}

export function CreateTicketWizard({ open, onClose, onSubmit }: CreateTicketWizardProps) {
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setSubject("");
    setPriority(null);
    setMessage("");
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: "8px",
    border: "1px solid var(--dash-modal-border, #1e2230)",
    background: "var(--dash-modal-input-bg, #16181f)",
    color: "var(--dash-text, #e2e8f0)",
    fontSize: "14px",
    outline: "none",
    transition: "border-color 0.2s",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--dash-text-muted, #64748b)",
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const renderStep = useCallback(
    ({ currentStep, setData }: WizardRenderProps) => {
      switch (currentStep) {
        case 0:
          return (
            <div>
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Subject</label>
                <input
                  className="r-input"
                  type="text"
                  placeholder="Describe your issue briefly"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setError(null);
                    setData("subject", e.target.value);
                  }}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--dash-accent, #8b5cf6)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)"; }}
                />
              </div>
              <p style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)" }}>
                Provide a clear, concise subject for your support ticket.
              </p>
            </div>
          );

        case 1:
          const priorities: Array<{ value: "low" | "medium" | "high"; label: string; color: string; desc: string }> = [
            { value: "low", label: "Low", color: "#22c55e", desc: "General questions, non-urgent" },
            { value: "medium", label: "Medium", color: "#f59e0b", desc: "Issues affecting some features" },
            { value: "high", label: "High", color: "#ef4444", desc: "Critical, blocking all usage" },
          ];
          return (
            <div>
              <p style={{ fontSize: "13px", color: "var(--dash-text-muted, #64748b)", marginBottom: "16px" }}>
                How urgent is this ticket?
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {priorities.map((p) => (
                  <div
                    key={p.value}
                    onClick={() => {
                      setPriority(p.value);
                      setError(null);
                      setData("priority", p.value);
                    }}
                    style={{
                      padding: "14px 16px",
                      borderRadius: "10px",
                      border: `1px solid ${priority === p.value ? p.color : "var(--dash-modal-border, #1e2230)"}`,
                      background: priority === p.value ? `${p.color}12` : "var(--dash-modal-input-bg, #16181f)",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      boxShadow: priority === p.value ? `0 0 12px ${p.color}25` : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (priority !== p.value) {
                        e.currentTarget.style.borderColor = `${p.color}60`;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (priority !== p.value) {
                        e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)";
                      }
                    }}
                  >
                    <div
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: p.color,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${p.color}`,
                      }}
                    />
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--dash-text, #e2e8f0)", marginBottom: "2px" }}>{p.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)" }}>{p.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );

        case 2:
          return (
            <div>
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>Message</label>
                <textarea
                  className="r-input"
                  placeholder="Describe your issue in detail..."
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setError(null);
                    setData("message", e.target.value);
                  }}
                  rows={6}
                  style={{ ...inputStyle, resize: "vertical", minHeight: "120px" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--dash-accent, #8b5cf6)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)"; }}
                />
              </div>
              <p style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)" }}>
                Include any relevant details: error messages, steps to reproduce, screenshots, etc.
              </p>
            </div>
          );

        case 3:
          return (
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--dash-text, #e2e8f0)", marginBottom: "16px" }}>
                Review your ticket
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { label: "Subject", value: subject || "—" },
                  { label: "Priority", value: priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : "—" },
                  { label: "Message", value: message || "—", full: true },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "8px",
                      background: "var(--dash-modal-input-bg, #16181f)",
                      border: "1px solid var(--dash-modal-border, #1e2230)",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)", marginBottom: item.full ? "8px" : "0" }}>{item.label}</div>
                    <div style={{ fontSize: "13px", color: "var(--dash-text, #e2e8f0)", wordBreak: "break-word", whiteSpace: item.full ? "pre-wrap" : "normal" }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)", marginTop: "16px" }}>
                Click "Submit Ticket" to open your support request.
              </p>
            </div>
          );

        default:
          return null;
      }
    },
    [subject, priority, message, labelStyle, inputStyle]
  );

  const validateStep = useCallback(
    ({ currentStep }: WizardRenderProps) => {
      switch (currentStep) {
        case 0:
          if (!subject.trim()) { setError("Subject is required"); return false; }
          break;
        case 1:
          if (!priority) { setError("Please select a priority"); return false; }
          break;
        case 2:
          if (!message.trim()) { setError("Message is required"); return false; }
          break;
      }
      setError(null);
      return true;
    },
    [subject, priority, message]
  );

  const handleComplete = useCallback(
    (_data: Record<string, unknown>) => {
      onSubmit({
        subject,
        priority: priority!,
        message,
      });
    },
    [subject, priority, message, onSubmit]
  );

  return (
    <WizardModal
      open={open}
      onClose={onClose}
      title="Create Support Ticket"
      stepCount={4}
      stepLabels={["Subject", "Priority", "Message", "Review"]}
      renderStep={renderStep}
      onComplete={handleComplete}
      accentColor="var(--dash-accent, #8b5cf6)"
    />
  );
}

// ─── BuyPlanWizard ────────────────────────────────────────────────────────────

interface BuyPlanWizardProps {
  open: boolean;
  onClose: () => void;
  onPurchase: (data: BuyPlanData) => void;
}

export interface BuyPlanData {
  plan: "rookie" | "elite" | "champion";
  paymentMethod: "btc" | "ltc";
}

interface PlanCardProps {
  name: string;
  price: string;
  features: string[];
  accentColor: string;
  selected: boolean;
  onClick: () => void;
}

function PlanCard({ name, price, features, accentColor, selected, onClick }: PlanCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "16px",
        borderRadius: "10px",
        border: `1px solid ${selected ? accentColor : "var(--dash-modal-border, #1e2230)"}`,
        background: selected ? `${accentColor}10` : "var(--dash-modal-input-bg, #16181f)",
        cursor: "pointer",
        transition: "all 0.2s",
        boxShadow: selected ? `0 0 16px ${accentColor}30` : "none",
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.borderColor = `${accentColor}60`;
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)";
        }
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: accentColor, textTransform: "uppercase", letterSpacing: "0.08em" }}>{name}</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--dash-text, #e2e8f0)", marginTop: "4px" }}>
            {price}
            <span style={{ fontSize: "12px", fontWeight: 400, color: "var(--dash-text-muted, #64748b)", marginLeft: "2px" }}>/mo</span>
          </div>
        </div>
        {selected && (
          <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: accentColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Check size={12} color="#fff" strokeWidth={3} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {features.map((feature, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Check size={12} color={accentColor} />
            <span style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)" }}>{feature}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BuyPlanWizard({ open, onClose, onPurchase }: BuyPlanWizardProps) {
  const [selectedPlan, setSelectedPlan] = useState<"rookie" | "elite" | "champion" | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"btc" | "ltc" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setSelectedPlan(null);
    setPaymentMethod(null);
    setCopied(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const plans: Record<string, { name: string; price: string; features: string[]; color: string }> = {
    rookie: { name: "Rookie", price: "$20.00", features: ["1 Bot", "5 Bot Hours/Day", "10 Proxies", "Basic Support", "Standard Speed", "24/7 Uptime"], color: "#64748b" },
    elite: { name: "Elite", price: "$35.00", features: ["5 Bots", "12 Bot Hours/Day", "50 Proxies", "Priority Support", "Fast Speed", "99.9% Uptime", "Custom Configs"], color: "#8b5cf6" },
    champion: { name: "Champion", price: "$55.00", features: ["25 Bots", "Unlimited Bot Hours", "Unlimited Proxies", "VIP Support", "Maximum Speed", "Dedicated Server", "Custom Branding"], color: "#f59e0b" },
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--dash-text-muted, #64748b)",
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const renderStep = useCallback(
    ({ currentStep, setData }: WizardRenderProps) => {
      switch (currentStep) {
        case 0:
          return (
            <div>
              <p style={{ fontSize: "13px", color: "var(--dash-text-muted, #64748b)", marginBottom: "16px" }}>
                Choose the plan that best fits your needs.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {Object.entries(plans).map(([key, plan]) => (
                  <PlanCard
                    key={key}
                    name={plan.name}
                    price={plan.price}
                    features={plan.features}
                    accentColor={plan.color}
                    selected={selectedPlan === key}
                    onClick={() => {
                      setSelectedPlan(key as "rookie" | "elite" | "champion");
                      setError(null);
                      setData("plan", key);
                    }}
                  />
                ))}
              </div>
            </div>
          );

        case 1:
          const coinStyle: React.CSSProperties = {
            padding: "16px 20px",
            borderRadius: "10px",
            border: `1px solid var(--dash-modal-border, #1e2230)`,
            background: "var(--dash-modal-input-bg, #16181f)",
            cursor: "pointer",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          };
          return (
            <div>
              <p style={{ fontSize: "13px", color: "var(--dash-text-muted, #64748b)", marginBottom: "16px" }}>
                Select your preferred payment method.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {[
                  { value: "btc" as const, label: "Bitcoin (BTC)", icon: <Bitcoin size={20} color="#f7931a" />, desc: "Fast and widely supported" },
                  { value: "ltc" as const, label: "Litecoin (LTC)", icon: <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#345d9d" /><path d="M21 21.5l-5-6.5h5l-2-4-4 6h3l-5 6.5h5l2 4 4-6h-3z" fill="white" /></svg>, desc: "Low fees, quick confirmation" },
                ].map((coin) => (
                  <div
                    key={coin.value}
                    onClick={() => {
                      setPaymentMethod(coin.value);
                      setError(null);
                      setData("paymentMethod", coin.value);
                    }}
                    style={{
                      ...coinStyle,
                      borderColor: paymentMethod === coin.value ? "var(--dash-accent, #8b5cf6)" : "var(--dash-modal-border, #1e2230)",
                      background: paymentMethod === coin.value ? "rgba(139, 92, 246, 0.08)" : "var(--dash-modal-input-bg, #16181f)",
                      boxShadow: paymentMethod === coin.value ? "0 0 12px rgba(139, 92, 246, 0.2)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (paymentMethod !== coin.value) {
                        e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.4)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (paymentMethod !== coin.value) {
                        e.currentTarget.style.borderColor = "var(--dash-modal-border, #1e2230)";
                      }
                    }}
                  >
                    {coin.icon}
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--dash-text, #e2e8f0)", marginBottom: "2px" }}>{coin.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)" }}>{coin.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );

        case 2:
          const plan = selectedPlan ? plans[selectedPlan] : null;
          const paymentLabel = paymentMethod === "btc" ? "Bitcoin (BTC)" : paymentMethod === "ltc" ? "Litecoin (LTC)" : "—";
          return (
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--dash-text, #e2e8f0)", marginBottom: "16px" }}>
                Review your order
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { label: "Plan", value: plan?.name || "—" },
                  { label: "Price", value: plan?.price || "—" },
                  { label: "Payment Method", value: paymentLabel },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      background: "var(--dash-modal-input-bg, #16181f)",
                      border: "1px solid var(--dash-modal-border, #1e2230)",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)" }}>{item.label}</span>
                    <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--dash-text, #e2e8f0)" }}>{item.value}</span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  borderRadius: "8px",
                  background: "rgba(139, 92, 246, 0.06)",
                  border: "1px solid rgba(139, 92, 246, 0.2)",
                  fontSize: "12px",
                  color: "var(--dash-text-muted, #64748b)",
                }}
              >
                A payment address will be generated on the next step. Payment is processed automatically.
              </div>
            </div>
          );

        case 3:
          const mockAddress = paymentMethod === "btc"
            ? "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
            : "LTC1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
          const addressColor = paymentMethod === "btc" ? "#f7931a" : "#345d9d";
          return (
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--dash-text, #e2e8f0)", marginBottom: "16px" }}>
                Complete your payment
              </p>

              {/* QR placeholder */}
              <div
                style={{
                  width: "160px",
                  height: "160px",
                  margin: "0 auto 20px",
                  borderRadius: "12px",
                  border: `2px solid var(--dash-modal-border, #1e2230)`,
                  background: "var(--dash-modal-input-bg, #16181f)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--dash-text-muted, #64748b)" strokeWidth="1.5">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <rect x="14" y="14" width="3" height="3" />
                  <rect x="18" y="14" width="3" height="3" />
                  <rect x="14" y="18" width="3" height="3" />
                  <rect x="18" y="18" width="3" height="3" />
                </svg>
                <span style={{ fontSize: "11px", color: "var(--dash-text-muted, #64748b)" }}>QR Code</span>
              </div>

              {/* Address */}
              <div style={{ marginBottom: "12px" }}>
                <label style={labelStyle}>Send exactly</label>
                <div style={{ fontSize: "20px", fontWeight: 700, color: addressColor }}>
                  {selectedPlan ? plans[selectedPlan].price : "—"} {paymentMethod?.toUpperCase()}
                </div>
              </div>

              <div>
                <label style={labelStyle}>Payment Address</label>
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--dash-modal-border, #1e2230)",
                    background: "var(--dash-modal-input-bg, #16181f)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--dash-text-muted, #64748b)",
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                      flex: 1,
                    }}
                  >
                    {mockAddress}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(mockAddress);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      border: `1px solid ${copied ? "#22c55e" : "var(--dash-modal-border, #1e2230)"}`,
                      background: copied ? "rgba(34, 197, 94, 0.1)" : "transparent",
                      color: copied ? "#22c55e" : "var(--dash-text-muted, #64748b)",
                      fontSize: "11px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    <Copy size={12} />
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              <p style={{ fontSize: "12px", color: "var(--dash-text-muted, #64748b)", marginTop: "12px", lineHeight: 1.6 }}>
                Send the exact amount to the address above. Your plan will be activated automatically after 1 confirmation.
              </p>
            </div>
          );

        default:
          return null;
      }
    },
    [selectedPlan, paymentMethod, plans, copied, labelStyle]
  );

  const validateStep = useCallback(
    ({ currentStep }: WizardRenderProps) => {
      switch (currentStep) {
        case 0:
          if (!selectedPlan) { setError("Please select a plan"); return false; }
          break;
        case 1:
          if (!paymentMethod) { setError("Please select a payment method"); return false; }
          break;
      }
      setError(null);
      return true;
    },
    [selectedPlan, paymentMethod]
  );

  const handleComplete = useCallback(
    (_data: Record<string, unknown>) => {
      onPurchase({
        plan: selectedPlan!,
        paymentMethod: paymentMethod!,
      });
    },
    [selectedPlan, paymentMethod, onPurchase]
  );

  return (
    <WizardModal
      open={open}
      onClose={onClose}
      title="Purchase Plan"
      stepCount={4}
      stepLabels={["Plan", "Payment", "Review", "Pay"]}
      renderStep={renderStep}
      onComplete={handleComplete}
      accentColor="var(--dash-accent, #8b5cf6)"
    />
  );
}
