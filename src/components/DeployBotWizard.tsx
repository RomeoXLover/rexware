import { useState, useEffect, useCallback } from "react";
import {
  Bot,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  HelpCircle,
  Settings2,
  Server,
  Lock,
  KeyRound,
  Zap,
  MessageSquare,
  Send,
  AlertCircle,
  Sparkles,
  X,
  Play,
  Star,
  Wifi,
  WifiOff,
  User,
  Clock,
  Shield,
  Gamepad2,
  Sparkle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Save,
  FolderOpen,
} from "lucide-react";
import { createBot } from "@/lib/api/bots.client";
import { useT } from "@/lib/preferences";

// ============================================================================
// Types
// ============================================================================

interface WizardProps {
  open: boolean;
  onClose: () => void;
  onDeployed?: (botId: string) => void;
  openWithDefaults?: Partial<BotConfig>;
}

interface BotConfig {
  name: string;
  serverHost: string;
  serverPort: number;
  mcVersion: string;
  description: string;
  authMode: "microsoft" | "offline" | "ssid";
  accessToken?: string;
  mcUsername?: string;
  uuid?: string;
  ssid?: string;
  message: string;
  messageInterval: number;
  afkEnabled: boolean;
  afkInterval: number;
  reconnectDelay: number;
  inactivityTimeout: number;
  smartAfk: boolean;
  replyMessage: string;
  triggerKeyword: string;
  replyDelay: number;
  cooldown: number;
  replyActions: string[];
  presetName: string;
  selectedPreset: string;
}

interface ValidationErrors {
  name?: string;
  serverHost?: string;
  serverPort?: string;
  accessToken?: string;
  mcUsername?: string;
  ssid?: string;
  message?: string;
  deployError?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MC_VERSIONS = [
  "1.21.4",
  "1.21.1",
  "1.20.6",
  "1.20.4",
  "1.20.1",
  "1.19.4",
  "1.18.2",
  "1.16.5",
  "1.12.2",
  "1.8.9",
];

const SERVER_PRESETS = [
  {
    name: "Hypixel",
    host: "hypixel.net",
    port: 25565,
    icon: "🎮",
    description: "Main network server",
  },
  {
    name: "Mineclubs",
    host: "play.mineclubs.com",
    port: 25565,
    icon: "⛏️",
    description: "Mining-focused server",
  },
  {
    name: "Custom",
    host: "",
    port: 25565,
    icon: "⚙️",
    description: "Enter your own server",
  },
];

const QUICK_ACTIONS = [
  { label: "/msg {user} {reply}", icon: MessageSquare },
  { label: "/party invite {user}", icon: User },
  { label: "/w {user} hello", icon: Send },
  { label: "/r {reply}", icon: Zap },
  { label: "/home {reply}", icon: Star },
];

const STORED_PRESETS_KEY = "skyutils_reply_presets";

// ============================================================================
// Utility Functions
// ============================================================================

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function validateIP(host: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)+$/;
  return ipv4Regex.test(host) || domainRegex.test(host);
}

function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// ============================================================================
// Confetti Component
// ============================================================================

function Confetti() {
  const colors = [
    "var(--nex-aqua)",
    "#22c55e",
    "#3b82f6",
    "#f59e0b",
    "#ec4899",
    "#8b5cf6",
    "#14b8a6",
  ];
  const pieces = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    color: colors[i % colors.length],
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.5}s`,
    duration: `${1 + Math.random() * 1}s`,
    size: `${6 + Math.random() * 8}px`,
  }));

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      {pieces.map((piece) => (
        <div
          key={piece.id}
          style={{
            position: "absolute",
            left: piece.left,
            top: "50%",
            width: piece.size,
            height: piece.size,
            background: piece.color,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            animation: `confetti-burst ${piece.duration} ease-out ${piece.delay} forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Step Progress Bar - Premium Animated
// ============================================================================

interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
}

function StepProgress({ currentStep, totalSteps, stepLabels }: StepProgressProps) {
  return (
    <div className="relative" style={{ marginBottom: "36px" }}>
      {/* Glow effect behind track */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "20px",
          right: "20px",
          height: "3px",
          transform: "translateY(-50%)",
          background: "rgba(114, 137, 218, 0.1)",
          borderRadius: "2px",
          filter: "blur(8px)",
        }}
      />

      {/* Background track */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "20px",
          right: "20px",
          height: "2px",
          transform: "translateY(-50%)",
          background: "rgba(255, 255, 255, 0.06)",
          borderRadius: "1px",
        }}
      />

      {/* Progress fill */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "20px",
          height: "2px",
          transform: "translateY(-50%)",
          background: `
            linear-gradient(90deg, 
              var(--nex-aqua) 0%, 
              rgba(114, 137, 218, 0.6) 100%
            )
          `,
          width: `${((currentStep - 1) / (totalSteps - 1)) * (100 - 40 / (totalSteps - 1) * 2)}%`,
          borderRadius: "1px",
          boxShadow: "0 0 16px rgba(114, 137, 218, 0.5)",
          transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />

      {/* Steps */}
      <div className="relative flex justify-between">
        {Array.from({ length: totalSteps }, (_, i) => {
          const stepNum = i + 1;
          const isDone = stepNum < currentStep;
          const isActive = stepNum === currentStep;
          const isPending = stepNum > currentStep;

          return (
            <div key={i} className="flex flex-col items-center">
              {/* Connector line */}
              {i < totalSteps - 1 && (
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: `calc(${i * 100 / (totalSteps - 1)}% + 20px)`,
                    width: `calc(${100 / (totalSteps - 1)}% - 40px)`,
                    height: "2px",
                    transform: "translateY(-50%)",
                    background: isDone 
                      ? "linear-gradient(90deg, var(--nex-aqua), rgba(114, 137, 218, 0.4))"
                      : "transparent",
                    transition: "background 0.3s ease",
                  }}
                />
              )}

              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  background: isActive
                    ? `
                      linear-gradient(135deg, 
                        var(--nex-aqua) 0%, 
                        rgba(114, 137, 218, 0.7) 100%
                      )
                    `
                    : isDone
                      ? "rgba(114, 137, 218, 0.25)"
                      : "rgba(255, 255, 255, 0.03)",
                  border: isActive
                    ? "3px solid var(--nex-aqua)"
                    : isDone
                      ? "2px solid rgba(114, 137, 218, 0.5)"
                      : "2px solid rgba(255, 255, 255, 0.08)",
                  boxShadow: isActive
                    ? `
                      0 0 0 8px rgba(114, 137, 218, 0.15),
                      0 0 30px rgba(114, 137, 218, 0.4)
                    `
                    : "none",
                  transform: isActive ? "scale(1.1)" : "scale(1)",
                  zIndex: 2,
                }}
              >
                {isDone ? (
                  <Check 
                    size={18} 
                    strokeWidth={3} 
                    style={{ color: "white" }} 
                  />
                ) : (
                  <span
                    className="text-sm font-bold"
                    style={{
                      color: isActive ? "white" : "var(--nex-muted)",
                    }}
                  >
                    {stepNum}
                  </span>
                )}
                {isActive && (
                  <div
                    style={{
                      position: "absolute",
                      inset: "-4px",
                      borderRadius: "50%",
                      background: "var(--nex-aqua)",
                      opacity: 0.15,
                      animation: "pulse-ring 2s ease-out infinite",
                    }}
                  />
                )}
              </div>
              <span
                className="mt-4 text-xs font-medium text-center"
                style={{
                  maxWidth: "80px",
                  color: isActive
                    ? "var(--nex-aqua)"
                    : isDone
                      ? "var(--nex-text)"
                      : "var(--nex-muted)",
                  fontWeight: isActive ? 600 : 400,
                  transition: "all 0.3s ease",
                }}
              >
                {stepLabels[i]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Help Panel Component
// ============================================================================

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function HelpPanel({ open, onClose, title, children }: HelpPanelProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        className="r-slide-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--nex-text)" }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="r-btn r-btn-ghost"
            style={{ padding: 6, borderRadius: 8 }}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ============================================================================
// Bot Preview Card
// ============================================================================

interface BotPreviewCardProps {
  config: BotConfig;
}

function BotPreviewCard({ config }: BotPreviewCardProps) {
  return (
    <div
      className="bot-preview-card"
      style={{
        marginTop: "24px",
        padding: "24px",
        background: `
          linear-gradient(135deg, 
            rgba(114, 137, 218, 0.1) 0%, 
            rgba(114, 137, 218, 0.02) 100%
          )
        `,
        borderRadius: "18px",
        border: "1px solid rgba(114, 137, 218, 0.2)",
      }}
    >
      <div className="flex items-center gap-5 mb-5">
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 16,
            background: `
              linear-gradient(135deg, 
                rgba(114, 137, 218, 0.35) 0%, 
                rgba(114, 137, 218, 0.12) 100%
              )
            `,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(114, 137, 218, 0.3)",
            boxShadow: "0 8px 32px rgba(114, 137, 218, 0.2)",
          }}
        >
          <Bot size={28} style={{ color: "var(--nex-aqua)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 18,
              color: "var(--nex-text)",
            }}
          >
            {config.name || "Unnamed Bot"}
          </div>
          <div style={{ fontSize: 14, color: "var(--nex-muted)" }}>
            {config.serverHost || "No server"}:{config.serverPort}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            background: "rgba(34, 197, 94, 0.1)",
            borderRadius: "12px",
            border: "1px solid rgba(34, 197, 94, 0.2)",
          }}
        >
          <Clock size={14} style={{ color: "#22c55e" }} />
          <span className="text-sm font-semibold" style={{ color: "#22c55e" }}>
            Ready
          </span>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-3"
        style={{
          padding: "18px",
          background: "rgba(255, 255, 255, 0.03)",
          borderRadius: "14px",
          border: "1px solid rgba(255, 255, 255, 0.05)",
        }}
      >
        <div className="flex items-center gap-3">
          <Gamepad2 size={16} style={{ color: "var(--nex-aqua)" }} />
          <span style={{ fontSize: 13, color: "var(--nex-text)" }}>
            MC {config.mcVersion}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Shield size={16} style={{ color: "var(--nex-aqua)" }} />
          <span style={{ fontSize: 13, color: "var(--nex-text)" }}>
            {config.authMode}
          </span>
        </div>
        {config.messageInterval > 0 && (
          <div className="flex items-center gap-3">
            <Clock size={16} style={{ color: "var(--nex-aqua)" }} />
            <span style={{ fontSize: 13, color: "var(--nex-text)" }}>
              {config.messageInterval}s interval
            </span>
          </div>
        )}
        {config.afkEnabled && (
          <div className="flex items-center gap-3">
            <Zap size={16} style={{ color: "var(--nex-aqua)" }} />
            <span style={{ fontSize: 13, color: "var(--nex-text)" }}>AFK enabled</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Glass Card Component
// ============================================================================

function GlassCard({
  children,
  variant = "default",
  className = "",
}: {
  children: React.ReactNode;
  variant?: "default" | "accent" | "glow";
  className?: string;
}) {
  const variantStyles = {
    default: {
      background: `
        linear-gradient(135deg, 
          rgba(255, 255, 255, 0.04) 0%, 
          rgba(255, 255, 255, 0.01) 100%
        )
      `,
      border: "1px solid rgba(255, 255, 255, 0.06)",
    },
    accent: {
      background: `
        linear-gradient(135deg, 
          rgba(114, 137, 218, 0.1) 0%, 
          rgba(114, 137, 218, 0.02) 100%
        )
      `,
      border: "1px solid rgba(114, 137, 218, 0.2)",
    },
    glow: {
      background: `
        linear-gradient(135deg, 
          rgba(114, 137, 218, 0.08) 0%, 
          rgba(114, 137, 218, 0.02) 100%
        )
      `,
      border: "1px solid rgba(114, 137, 218, 0.25)",
      boxShadow: "0 0 40px rgba(114, 137, 218, 0.1)",
    },
  };

  return (
    <div
      className={`glass-card ${className}`}
      style={{
        padding: "28px",
        borderRadius: "20px",
        backdropFilter: "blur(20px)",
        ...variantStyles[variant],
      }}
    >
      {children}
    </div>
  );
}

function GlassInput({
  className = "",
  error = false,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      className={`r-input ${error ? "error" : ""} ${className}`}
      style={{
        background: "rgba(255, 255, 255, 0.04)",
        border: error
          ? "1px solid rgba(239, 68, 68, 0.5)"
          : "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "14px",
        padding: "14px 18px",
        fontSize: "14px",
        transition: "all 0.2s ease",
        color: "var(--nex-text)",
      }}
      {...props}
    />
  );
}

// ============================================================================
// Step 1: Bot Setup
// ============================================================================

interface Step1Props {
  config: BotConfig;
  setConfig: React.Dispatch<React.SetStateAction<BotConfig>>;
  errors: ValidationErrors;
}

function Step1BotSetup({ config, setConfig, errors }: Step1Props) {
  const t = useT();
  const [showPreview, setShowPreview] = useState(true);

  const updateField = <K extends keyof BotConfig>(field: K, value: BotConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const applyPreset = (preset: (typeof SERVER_PRESETS)[number]) => {
    updateField("serverHost", preset.host);
    updateField("serverPort", preset.port);
  };

  const isValidIP = config.serverHost ? validateIP(config.serverHost) : true;
  const isValidPort = validatePort(config.serverPort);

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      <GlassCard>
        <div className="flex items-center gap-5 mb-8">
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `
                linear-gradient(135deg, 
                  rgba(114, 137, 218, 0.35) 0%, 
                  rgba(114, 137, 218, 0.12) 100%
                )
              `,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(114, 137, 218, 0.3)",
              boxShadow: "0 8px 32px rgba(114, 137, 218, 0.2)",
            }}
          >
            <Bot size={26} style={{ color: "var(--nex-aqua)" }} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: "var(--nex-text)",
                letterSpacing: "-0.01em",
              }}
            >
              Bot Setup
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: "var(--nex-muted)" }}>
              Configure your bot's basic settings and server connection.
            </p>
          </div>
        </div>

        {/* Bot Name */}
        <div className="mb-6">
          <label
            className="flex items-center gap-2 text-sm font-semibold mb-3"
            style={{ color: "var(--nex-text)" }}
          >
            <Bot size={15} style={{ color: "var(--nex-aqua)" }} />
            Bot Name
            <span style={{ color: "var(--nex-aqua)" }}>*</span>
          </label>
          <GlassInput
            placeholder="My Awesome Bot"
            value={config.name}
            onChange={(e) => updateField("name", e.target.value)}
            maxLength={40}
            error={!!errors.name}
          />
          {errors.name && (
            <div className="flex items-center gap-2 mt-3 text-sm" style={{ color: "#ef4444" }}>
              <AlertCircle size={14} />
              {errors.name}
            </div>
          )}
          <div className="text-xs mt-3" style={{ color: "var(--nex-muted)" }}>
            {config.name.length}/40 characters
          </div>
        </div>

        {/* Server Presets */}
        <div className="mb-6">
          <label
            className="flex items-center gap-2 text-sm font-semibold mb-4"
            style={{ color: "var(--nex-text)" }}
          >
            <Server size={15} style={{ color: "var(--nex-aqua)" }} />
            Quick Server Presets
          </label>
          <div className="grid grid-cols-3 gap-4">
            {SERVER_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                className="r-btn r-btn-outline"
                style={{
                  padding: "20px 12px",
                  fontSize: 13,
                  flexDirection: "column",
                  gap: 10,
                  height: "auto",
                  borderRadius: "16px",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                }}
              >
                <span style={{ fontSize: 28 }}>{preset.icon}</span>
                <span className="font-semibold">{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Server Host & Port */}
        <div className="mb-6">
          <label
            className="flex items-center gap-2 text-sm font-semibold mb-3"
            style={{ color: "var(--nex-text)" }}
          >
            <Wifi size={15} style={{ color: "var(--nex-aqua)" }} />
            Server Host
          </label>
          <div className="flex gap-4">
            <GlassInput
              placeholder="hypixel.net"
              value={config.serverHost}
              onChange={(e) => updateField("serverHost", e.target.value)}
              style={{ flex: 2 }}
            />
            <GlassInput
              type="number"
              placeholder="25565"
              value={config.serverPort}
              onChange={(e) => updateField("serverPort", parseInt(e.target.value) || 25565)}
              style={{ flex: 1, maxWidth: 120 }}
            />
          </div>
          <div className="flex items-center gap-4 mt-4">
            {config.serverHost && (
              <div
                className="flex items-center gap-2 text-sm"
                style={{
                  color: isValidIP ? "#22c55e" : "#ef4444",
                }}
              >
                {isValidIP ? <Check size={14} /> : <X size={14} />}
                {isValidIP ? "Valid server address" : "Invalid server address"}
              </div>
            )}
            {!isValidPort && (
              <div className="flex items-center gap-2 text-sm" style={{ color: "#ef4444" }}>
                <X size={14} />
                Port must be 1-65535
              </div>
            )}
          </div>
        </div>

        {/* Minecraft Version */}
        <div className="mb-6">
          <label
            className="flex items-center gap-2 text-sm font-semibold mb-3"
            style={{ color: "var(--nex-text)" }}
          >
            <Gamepad2 size={15} style={{ color: "var(--nex-aqua)" }} />
            Minecraft Version
          </label>
          <select
            className="r-input"
            value={config.mcVersion}
            onChange={(e) => updateField("mcVersion", e.target.value)}
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "14px",
              padding: "14px 18px",
              fontSize: "14px",
              cursor: "pointer",
              color: "var(--nex-text)",
              width: "100%",
            }}
          >
            {MC_VERSIONS.map((ver) => (
              <option key={ver} value={ver}>
                Minecraft {ver}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div className="mb-8">
          <label
            className="flex items-center gap-2 text-sm font-semibold mb-3"
            style={{ color: "var(--nex-text)" }}
          >
            <MessageSquare size={15} style={{ color: "var(--nex-aqua)" }} />
            Description (optional)
          </label>
          <textarea
            className="r-input"
            placeholder="Notes about this bot configuration..."
            value={config.description}
            onChange={(e) => updateField("description", e.target.value)}
            rows={3}
            style={{
              resize: "vertical",
              minHeight: 90,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "14px",
              padding: "14px 18px",
              fontSize: "14px",
              color: "var(--nex-text)",
            }}
          />
        </div>

        {/* Live Preview Toggle */}
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="r-btn r-btn-ghost w-full"
          style={{
            padding: "16px 20px",
            borderRadius: "14px",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            justifyContent: "space-between",
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          <span className="flex items-center gap-3">
            <Sparkle size={18} style={{ color: "var(--nex-aqua)" }} />
            <span className="font-semibold">Live Preview</span>
          </span>
          {showPreview ? (
            <ChevronUp size={18} />
          ) : (
            <ChevronDown size={18} />
          )}
        </button>

        {showPreview && <BotPreviewCard config={config} />}
      </GlassCard>
    </div>
  );
}

// ============================================================================
// Step 2: Authentication
// ============================================================================

interface Step2Props {
  config: BotConfig;
  setConfig: React.Dispatch<React.SetStateAction<BotConfig>>;
  errors: ValidationErrors;
}

function Step2Authentication({ config, setConfig, errors }: Step2Props) {
  const t = useT();
  const [showToken, setShowToken] = useState(false);
  const [showSSID, setShowSSID] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedUsername, setConnectedUsername] = useState("");
  const [showSSIDHelp, setShowSSIDHelp] = useState(false);
  const [showTokenHelp, setShowTokenHelp] = useState(false);

  const updateField = <K extends keyof BotConfig>(field: K, value: BotConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleMicrosoftLogin = async () => {
    setIsConnecting(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setIsConnecting(false);
    setIsConnected(true);
    setConnectedUsername("Player" + Math.floor(Math.random() * 9999));
    updateField("accessToken", "mock_token_" + Date.now());
  };

  const authModes = [
    { id: "microsoft", label: "Microsoft", icon: Shield },
    { id: "offline", label: "Offline", icon: WifiOff },
    { id: "ssid", label: "SSID", icon: KeyRound },
  ] as const;

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      <GlassCard>
        <div className="flex items-center gap-5 mb-8">
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `
                linear-gradient(135deg, 
                  rgba(114, 137, 218, 0.35) 0%, 
                  rgba(114, 137, 218, 0.12) 100%
                )
              `,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(114, 137, 218, 0.3)",
              boxShadow: "0 8px 32px rgba(114, 137, 218, 0.2)",
            }}
          >
            <Lock size={26} style={{ color: "var(--nex-aqua)" }} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: "var(--nex-text)",
                letterSpacing: "-0.01em",
              }}
            >
              Authentication
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: "var(--nex-muted)" }}>
              Choose how to authenticate with the Minecraft server.
            </p>
          </div>
        </div>

        {/* Auth Mode Tabs */}
        <div
          className="grid grid-cols-3 gap-2 p-2 mb-8"
          style={{
            background: "rgba(255, 255, 255, 0.02)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            borderRadius: "16px",
          }}
        >
          {authModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => updateField("authMode", mode.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                padding: "14px 16px",
                borderRadius: "12px",
                transition: "all 0.2s ease",
                fontWeight: config.authMode === mode.id ? 600 : 400,
                fontSize: 14,
                background: config.authMode === mode.id
                  ? "linear-gradient(135deg, var(--nex-aqua) 0%, rgba(114, 137, 218, 0.7) 100%)"
                  : "transparent",
                border: config.authMode === mode.id
                  ? "none"
                  : "1px solid transparent",
                color: config.authMode === mode.id ? "white" : "var(--nex-muted)",
                cursor: "pointer",
              }}
            >
              <mode.icon size={18} />
              {mode.label}
            </button>
          ))}
        </div>

        {/* Microsoft Auth */}
        {config.authMode === "microsoft" && (
          <div>
            {isConnected ? (
              <div
                style={{
                  padding: "28px",
                  background: `
                    linear-gradient(135deg, 
                      rgba(34, 197, 94, 0.1) 0%, 
                      rgba(34, 197, 94, 0.02) 100%
                    )
                  `,
                  borderRadius: "18px",
                  border: "1px solid rgba(34, 197, 94, 0.2)",
                }}
              >
                <div className="flex items-center gap-5">
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: "50%",
                      background: `
                        linear-gradient(135deg, 
                          rgba(34, 197, 94, 0.2) 0%, 
                          rgba(34, 197, 94, 0.05) 100%
                        )
                      `,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "3px solid rgba(34, 197, 94, 0.3)",
                    }}
                  >
                    <User size={32} style={{ color: "#22c55e" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 20,
                        color: "var(--nex-text)",
                      }}
                    >
                      Connected as {connectedUsername}
                    </div>
                    <div
                      className="flex items-center gap-2 text-sm mt-2"
                      style={{ color: "#22c55e" }}
                    >
                      <Check size={16} />
                      Microsoft account verified
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-6">
                  <label
                    className="flex items-center justify-between text-sm font-semibold mb-3"
                    style={{ color: "var(--nex-text)" }}
                  >
                    <span className="flex items-center gap-2">
                      <Lock size={15} style={{ color: "var(--nex-aqua)" }} />
                      Access Token
                    </span>
                    <button
                      onClick={() => setShowTokenHelp(true)}
                      className="r-btn r-btn-ghost"
                      style={{ padding: 6 }}
                    >
                      <HelpCircle size={16} />
                    </button>
                  </label>
                  <div style={{ position: "relative" }}>
                    <GlassInput
                      type={showToken ? "text" : "password"}
                      placeholder="Paste your Microsoft access token"
                      value={config.accessToken}
                      onChange={(e) => updateField("accessToken", e.target.value)}
                      error={!!errors.accessToken}
                      style={{ paddingRight: 52 }}
                    />
                    <button
                      onClick={() => setShowToken(!showToken)}
                      style={{
                        position: "absolute",
                        right: 14,
                        top: "50%",
                        transform: "translateY(-50%)",
                        padding: 8,
                        borderRadius: 10,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--nex-muted)",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {showToken ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleMicrosoftLogin}
                  disabled={isConnecting}
                  className="r-btn r-btn-primary w-full"
                  style={{
                    padding: "18px 24px",
                    fontSize: 15,
                    fontWeight: 600,
                    borderRadius: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "12px",
                  }}
                >
                  {isConnecting ? (
                    <>
                      <Loader2
                        size={20}
                        style={{ animation: "ac-spin 1s linear infinite" }}
                      />
                      Connecting to Microsoft...
                    </>
                  ) : (
                    <>
                      <Shield size={20} />
                      Login with Microsoft
                    </>
                  )}
                </button>

                <div
                  className="flex items-start gap-3 mt-5 p-4 rounded-xl"
                  style={{
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                  }}
                >
                  <Lock
                    size={16}
                    style={{ color: "var(--nex-muted)", flexShrink: 0, marginTop: 2 }}
                  />
                  <span className="text-sm" style={{ color: "var(--nex-muted)" }}>
                    Your access token is encrypted and stored securely. We never share your
                    authentication credentials.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Offline Auth */}
        {config.authMode === "offline" && (
          <div>
            <div className="mb-5">
              <label
                className="flex items-center gap-2 text-sm font-semibold mb-3"
                style={{ color: "var(--nex-text)" }}
              >
                <User size={15} style={{ color: "var(--nex-aqua)" }} />
                Minecraft Username
                <span style={{ color: "var(--nex-aqua)" }}>*</span>
              </label>
              <GlassInput
                placeholder="YourPlayerName"
                value={config.mcUsername}
                onChange={(e) => updateField("mcUsername", e.target.value)}
                maxLength={16}
                error={!!errors.mcUsername}
              />
              {errors.mcUsername && (
                <div className="flex items-center gap-2 mt-3 text-sm" style={{ color: "#ef4444" }}>
                  <AlertCircle size={14} />
                  {errors.mcUsername}
                </div>
              )}
            </div>

            <div className="mb-5">
              <label
                className="flex items-center justify-between text-sm font-semibold mb-3"
                style={{ color: "var(--nex-text)" }}
              >
                <span className="flex items-center gap-2">
                  <KeyRound size={15} style={{ color: "var(--nex-aqua)" }} />
                  UUID (optional)
                </span>
                <button
                  onClick={() => updateField("uuid", generateUUID())}
                  className="r-btn r-btn-outline"
                  style={{ padding: "8px 16px", fontSize: 12 }}
                >
                  Generate
                </button>
              </label>
              <GlassInput
                placeholder="Auto-generated if empty"
                value={config.uuid}
                onChange={(e) => updateField("uuid", e.target.value)}
              />
            </div>

            <div
              className="flex items-start gap-3 p-4 rounded-xl"
              style={{
                background: "rgba(245, 158, 11, 0.08)",
                border: "1px solid rgba(245, 158, 11, 0.2)",
              }}
            >
              <AlertCircle
                size={18}
                style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }}
              />
              <span className="text-sm" style={{ color: "#f59e0b" }}>
                Offline mode requires a premium Minecraft account. Some servers may block
                offline-mode players.
              </span>
            </div>
          </div>
        )}

        {/* SSID Auth */}
        {config.authMode === "ssid" && (
          <div>
            <div className="mb-5">
              <label
                className="flex items-center justify-between text-sm font-semibold mb-3"
                style={{ color: "var(--nex-text)" }}
              >
                <span className="flex items-center gap-2">
                  <KeyRound size={15} style={{ color: "var(--nex-aqua)" }} />
                  SSID Token
                </span>
                <button
                  onClick={() => setShowSSIDHelp(true)}
                  className="r-btn r-btn-ghost"
                  style={{ padding: 6 }}
                >
                  <HelpCircle size={16} />
                </button>
              </label>
              <div style={{ position: "relative" }}>
                <GlassInput
                  type={showSSID ? "text" : "password"}
                  placeholder="Enter your SSID token"
                  value={config.ssid}
                  onChange={(e) => updateField("ssid", e.target.value)}
                  error={!!errors.ssid}
                  style={{ paddingRight: 52 }}
                />
                <button
                  onClick={() => setShowSSID(!showSSID)}
                  style={{
                    position: "absolute",
                    right: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    padding: 8,
                    borderRadius: 10,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--nex-muted)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {showSSID ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div
              className="p-5 rounded-xl"
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              <strong style={{ color: "var(--nex-text)", fontSize: 14 }}>What is SSID?</strong>
              <p className="mt-3 text-sm" style={{ color: "var(--nex-muted)", lineHeight: 1.7 }}>
                SSID (Session ID) is a token-based authentication method used by some
                cracked server launchers. Click the help icon for instructions.
              </p>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Help Panels */}
      <HelpPanel
        open={showSSIDHelp}
        onClose={() => setShowSSIDHelp(false)}
        title="How to get SSID"
      >
        <div style={{ color: "var(--nex-text)", fontSize: 14, lineHeight: 1.7 }}>
          <p style={{ marginTop: 0 }}>
            SSID authentication is typically used with cracked Minecraft launchers.
          </p>
          <h4 style={{ fontSize: 15, marginBottom: 12 }}>To get your SSID:</h4>
          <ol style={{ paddingLeft: 20, marginBottom: 20 }}>
            <li>Open your Minecraft launcher</li>
            <li>Go to Settings or Account</li>
            <li>Look for "SSID" or "Session ID"</li>
            <li>Copy the token and paste it here</li>
          </ol>
          <div
            style={{
              background: "var(--nex-bg)",
              borderRadius: 10,
              padding: 16,
              textAlign: "center",
              color: "var(--nex-muted)",
              fontSize: 12,
            }}
          >
            [Screenshot placeholder: SSID location in launcher]
          </div>
        </div>
      </HelpPanel>

      <HelpPanel
        open={showTokenHelp}
        onClose={() => setShowTokenHelp(false)}
        title="Token Security"
      >
        <div style={{ color: "var(--nex-text)", fontSize: 14, lineHeight: 1.7 }}>
          <p style={{ marginTop: 0 }}>
            Your Microsoft access token is used to authenticate with Minecraft services.
          </p>
          <h4 style={{ fontSize: 15, marginBottom: 12 }}>Security features:</h4>
          <ul style={{ paddingLeft: 20, marginBottom: 20 }}>
            <li>Tokens are encrypted at rest using AES-256</li>
            <li>Never stored in plain text</li>
            <li>Automatically expired after 24 hours</li>
            <li>Can be revoked anytime from your Microsoft account</li>
          </ul>
          <div
            style={{
              padding: 16,
              background: "rgba(34, 197, 94, 0.1)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: 10,
              fontSize: 13,
              color: "#22c55e",
            }}
          >
            Your credentials are safe with us.
          </div>
        </div>
      </HelpPanel>
    </div>
  );
}

// ============================================================================
// Step 3: Behavior Configuration
// ============================================================================

interface Step3Props {
  config: BotConfig;
  setConfig: React.Dispatch<React.SetStateAction<BotConfig>>;
}

function Step3Behavior({ config, setConfig }: Step3Props) {
  const t = useT();
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const updateField = <K extends keyof BotConfig>(field: K, value: BotConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const toggleExpand = (id: string) => {
    setExpandedCard(expandedCard === id ? null : id);
  };

  const featureCards = [
    {
      id: "messaging",
      icon: MessageSquare,
      title: "Auto Messaging",
      description: "Messages sent every interval to keep presence active",
      alwaysExpanded: true,
      expanded: (
        <div style={{ paddingTop: 20 }}>
          <textarea
            className="r-input"
            placeholder={'e.g.  888 to join my server  :))  or  psst  come play w us  :?'}
            value={config.message}
            onChange={(e) => updateField("message", e.target.value)}
            rows={3}
            style={{
              marginBottom: 20,
              resize: "vertical",
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "14px",
              padding: "14px 18px",
              fontSize: "14px",
              color: "var(--nex-text)",
            }}
          />
          <p style={{ fontSize: 11, color: "var(--nex-muted)", marginBottom: 16, lineHeight: 1.6 }}>
            Tip: use variations like <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4, fontFamily: "monospace" }}>:))</code>{" "}
            <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4, fontFamily: "monospace" }}>:? </code>{" "}
            <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4, fontFamily: "monospace" }}>:$ </code>{" "}
            extra spaces and unicode symbols to vary the message and avoid mute filters.
          </p>
          <div>
            <div className="flex justify-between text-sm mb-3">
              <span>Interval: {config.messageInterval}s</span>
            </div>
            <input
              type="range"
              min={1}
              max={60}
              step={0.5}
              value={config.messageInterval}
              onChange={(e) => updateField("messageInterval", parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
            <div
              className="flex justify-between text-xs mt-3"
              style={{ color: "var(--nex-muted)" }}
            >
              <span>1s</span>
              <span>60s</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "afk",
      icon: Clock,
      title: "AFK Detection",
      description: "Stay connected when idle",
      expanded: (
        <div style={{ paddingTop: 20 }}>
          <div className="flex items-center justify-between mb-5">
            <span style={{ fontSize: 14, color: "var(--nex-text)", fontWeight: 500 }}>Enable AFK Detection</span>
            <button
              onClick={() => updateField("afkEnabled", !config.afkEnabled)}
              style={{
                width: 52,
                height: 28,
                borderRadius: 14,
                background: config.afkEnabled ? "var(--nex-aqua)" : "rgba(255, 255, 255, 0.1)",
                border: "none",
                cursor: "pointer",
                position: "relative",
                transition: "all 0.2s ease",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "white",
                  transition: "left 0.2s ease",
                  left: config.afkEnabled ? 28 : 4,
                }}
              />
            </button>
          </div>
          <div className="mb-5">
            <label
              className="block text-sm mb-3"
              style={{ color: "var(--nex-muted)", fontWeight: 500 }}
            >
              AFK Interval (seconds)
            </label>
            <GlassInput
              type="number"
              value={config.afkInterval}
              onChange={(e) => updateField("afkInterval", parseInt(e.target.value) || 30)}
              min={1}
              max={3600}
            />
          </div>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 14, color: "var(--nex-text)", fontWeight: 500 }}>Smart AFK (walk around)</span>
            <button
              onClick={() => updateField("smartAfk", !config.smartAfk)}
              style={{
                width: 52,
                height: 28,
                borderRadius: 14,
                background: config.smartAfk ? "var(--nex-aqua)" : "rgba(255, 255, 255, 0.1)",
                border: "none",
                cursor: "pointer",
                position: "relative",
                transition: "all 0.2s ease",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "white",
                  transition: "left 0.2s ease",
                  left: config.smartAfk ? 28 : 4,
                }}
              />
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "reconnect",
      icon: Wifi,
      title: "Reconnection",
      description: "Auto-reconnect settings",
      expanded: (
        <div style={{ paddingTop: 20 }}>
          <div className="mb-5">
            <label className="block text-sm mb-3" style={{ color: "var(--nex-muted)", fontWeight: 500 }}>
              Reconnect Delay (seconds)
            </label>
            <GlassInput
              type="number"
              value={config.reconnectDelay}
              onChange={(e) => updateField("reconnectDelay", parseInt(e.target.value) || 5)}
              min={1}
              max={3600}
            />
          </div>
          <div>
            <label className="block text-sm mb-3" style={{ color: "var(--nex-muted)", fontWeight: 500 }}>
              Inactivity Timeout (seconds, 0 = disabled)
            </label>
            <GlassInput
              type="number"
              value={config.inactivityTimeout}
              onChange={(e) => updateField("inactivityTimeout", parseInt(e.target.value) || 0)}
              min={0}
              max={86400}
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      <GlassCard>
        <div className="flex items-center gap-5 mb-8">
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `
                linear-gradient(135deg, 
                  rgba(114, 137, 218, 0.35) 0%, 
                  rgba(114, 137, 218, 0.12) 100%
                )
              `,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(114, 137, 218, 0.3)",
              boxShadow: "0 8px 32px rgba(114, 137, 218, 0.2)",
            }}
          >
            <Settings2 size={26} style={{ color: "var(--nex-aqua)" }} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: "var(--nex-text)",
                letterSpacing: "-0.01em",
              }}
            >
              Behavior Configuration
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: "var(--nex-muted)" }}>
              Customize how your bot behaves on the server.
            </p>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="flex flex-col gap-4">
          {featureCards.map((card) => (
            <div
              key={card.id}
              style={{
                padding: "24px",
                borderRadius: "18px",
                cursor: card.alwaysExpanded ? "default" : "pointer",
                transition: "all 0.25s ease",
                background:
                  expandedCard === card.id || card.alwaysExpanded
                    ? `
                      linear-gradient(135deg,
                        rgba(114, 137, 218, 0.08) 0%,
                        rgba(114, 137, 218, 0.02) 100%
                      )
                    `
                    : "rgba(255, 255, 255, 0.02)",
                border: `1px solid ${expandedCard === card.id || card.alwaysExpanded ? "rgba(114, 137, 218, 0.25)" : "rgba(255, 255, 255, 0.05)"}`,
                boxShadow:
                  expandedCard === card.id || card.alwaysExpanded
                    ? "0 8px 32px rgba(114, 137, 218, 0.1)"
                    : "none",
              }}
              onClick={() => !card.alwaysExpanded && toggleExpand(card.id)}
            >
              <div className="flex items-center gap-5">
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background:
                      expandedCard === card.id || card.alwaysExpanded
                        ? `
                          linear-gradient(135deg,
                            rgba(114, 137, 218, 0.3) 0%,
                            rgba(114, 137, 218, 0.1) 100%
                          )
                        `
                        : "rgba(255, 255, 255, 0.03)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${expandedCard === card.id || card.alwaysExpanded ? "rgba(114, 137, 218, 0.3)" : "rgba(255, 255, 255, 0.05)"}`,
                    transition: "all 0.2s ease",
                  }}
                >
                  <card.icon
                    size={24}
                    style={{ color: "var(--nex-aqua)" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{ fontWeight: 600, fontSize: 16, color: "var(--nex-text)" }}
                  >
                    {card.title}
                  </div>
                  <div style={{ fontSize: 14, color: "var(--nex-muted)" }}>
                    {card.description}
                  </div>
                </div>
                {!card.alwaysExpanded && (
                  <Settings2
                    size={20}
                    style={{
                      color: "var(--nex-muted)",
                      transform: expandedCard === card.id ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                )}
              </div>
              {(expandedCard === card.id || card.alwaysExpanded) && (
                <div onClick={(e) => e.stopPropagation()}>{card.expanded}</div>
              )}
            </div>
          ))}
        </div>

        {/* Message Interval Visual Preview */}
        {config.messageInterval > 0 && (
          <div
            style={{
              marginTop: "24px",
              padding: "24px",
              background: "rgba(255, 255, 255, 0.02)",
              borderRadius: "16px",
              border: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            <div
              className="text-sm font-semibold mb-5"
              style={{ color: "var(--nex-text)" }}
            >
              Message Timing Preview
            </div>
            <div className="flex items-center gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    transition: "all 0.3s ease",
                    background:
                      i === 0 ? "var(--nex-aqua)" : "rgba(255, 255, 255, 0.1)",
                    boxShadow:
                      i === 0 ? "0 0 16px var(--nex-aqua)" : "none",
                    animation:
                      i === 0 && config.messageInterval <= 5
                        ? "pulse-ring 1s ease-in-out infinite"
                        : "none",
                  }}
                />
              ))}
              <span className="text-sm ml-4" style={{ color: "var(--nex-muted)" }}>
                Every {config.messageInterval}s
              </span>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ============================================================================
// Step 4: Reply Actions
// ============================================================================

interface Step4Props {
  config: BotConfig;
  setConfig: React.Dispatch<React.SetStateAction<BotConfig>>;
}

function Step4ReplyActions({ config, setConfig }: Step4Props) {
  const t = useT();
  const [savedPresets, setSavedPresets] = useState<{ name: string; actions: string[] }[]>([]);
  const [showPresetInput, setShowPresetInput] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORED_PRESETS_KEY);
    if (stored) {
      try {
        setSavedPresets(JSON.parse(stored));
      } catch {
        setSavedPresets([]);
      }
    }
  }, []);

  const updateField = <K extends keyof BotConfig>(field: K, value: BotConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const addAction = () => {
    updateField("replyActions", [...config.replyActions, ""]);
  };

  const removeAction = (index: number) => {
    updateField(
      "replyActions",
      config.replyActions.filter((_, i) => i !== index),
    );
  };

  const updateAction = (index: number, value: string) => {
    const newActions = [...config.replyActions];
    newActions[index] = value;
    updateField("replyActions", newActions);
  };

  const insertQuickAction = (actionTemplate: string, targetIndex: number) => {
    const newActions = [...config.replyActions];
    newActions[targetIndex] = actionTemplate;
    updateField("replyActions", newActions);
  };

  const savePreset = () => {
    if (!config.presetName.trim() || config.replyActions.length === 0) return;
    const newPreset = {
      name: config.presetName,
      actions: [...config.replyActions],
    };
    const updatedPresets = [...savedPresets, newPreset];
    setSavedPresets(updatedPresets);
    localStorage.setItem(STORED_PRESETS_KEY, JSON.stringify(updatedPresets));
    updateField("presetName", "");
    setShowPresetInput(false);
  };

  const loadPreset = (preset: { name: string; actions: string[] }) => {
    updateField("replyActions", [...preset.actions]);
    updateField("selectedPreset", preset.name);
  };

  const deletePreset = (name: string) => {
    const updatedPresets = savedPresets.filter((p) => p.name !== name);
    setSavedPresets(updatedPresets);
    localStorage.setItem(STORED_PRESETS_KEY, JSON.stringify(updatedPresets));
  };

  return (
    <div style={{ animation: "fadeUp 0.4s ease" }}>
      <GlassCard>
        <div className="flex items-center gap-5 mb-8">
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `
                linear-gradient(135deg, 
                  rgba(114, 137, 218, 0.35) 0%, 
                  rgba(114, 137, 218, 0.12) 100%
                )
              `,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(114, 137, 218, 0.3)",
              boxShadow: "0 8px 32px rgba(114, 137, 218, 0.2)",
            }}
          >
            <MessageSquare size={26} style={{ color: "var(--nex-aqua)" }} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: "var(--nex-text)",
                letterSpacing: "-0.01em",
              }}
            >
              Reply Actions
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: "var(--nex-muted)" }}>
              Configure automatic replies and actions when triggered.
            </p>
          </div>
        </div>

        {/* Reply Message */}
        <div className="mb-6">
          <label
            className="flex items-center gap-2 text-sm font-semibold mb-3"
            style={{ color: "var(--nex-text)" }}
          >
            <MessageSquare size={15} style={{ color: "var(--nex-aqua)" }} />
            Reply Message
          </label>
          <textarea
            className="r-input"
            placeholder="Enter the message to send when triggered..."
            value={config.replyMessage}
            onChange={(e) => updateField("replyMessage", e.target.value)}
            rows={3}
            style={{
              resize: "vertical",
              marginBottom: 12,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "14px",
              padding: "14px 18px",
              fontSize: "14px",
              color: "var(--nex-text)",
            }}
          />
        </div>

        {/* Trigger & Delays Row */}
        <div className="grid grid-cols-3 gap-5 mb-8">
          <div>
            <label
              className="block text-sm font-semibold mb-3"
              style={{ color: "var(--nex-text)" }}
            >
              Trigger Keyword
            </label>
            <GlassInput
              placeholder="!ping"
              value={config.triggerKeyword}
              onChange={(e) => updateField("triggerKeyword", e.target.value)}
            />
          </div>
          <div>
            <label
              className="block text-sm font-semibold mb-3"
              style={{ color: "var(--nex-text)" }}
            >
              Reply Delay (s)
            </label>
            <GlassInput
              type="number"
              value={config.replyDelay}
              onChange={(e) => updateField("replyDelay", parseInt(e.target.value) || 0)}
              min={0}
              max={600}
            />
          </div>
          <div>
            <label
              className="block text-sm font-semibold mb-3"
              style={{ color: "var(--nex-text)" }}
            >
              Cooldown (s)
            </label>
            <GlassInput
              type="number"
              value={config.cooldown}
              onChange={(e) => updateField("cooldown", parseInt(e.target.value) || 0)}
              min={0}
              max={3600}
            />
          </div>
        </div>

        {/* Reply Actions Editor */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-5">
            <label
              className="text-sm font-semibold"
              style={{ color: "var(--nex-text)" }}
            >
              Reply Actions ({config.replyActions.length})
            </label>
            <button
              onClick={addAction}
              className="r-btn r-btn-outline"
              style={{
                padding: "10px 18px",
                borderRadius: "12px",
              }}
            >
              <Plus size={15} />
              Add
            </button>
          </div>

          {/* Quick Action Chips */}
          <div className="flex flex-wrap gap-3 mb-5">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() =>
                  insertQuickAction(action.label, config.replyActions.length)
                }
                className="r-btn r-btn-ghost"
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  borderRadius: "20px",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
              >
                <action.icon size={13} />
                <span className="ml-2">
                  {action.label.length > 22
                    ? action.label.slice(0, 22) + "..."
                    : action.label}
                </span>
              </button>
            ))}
          </div>

          {/* Action Lines */}
          <div className="flex flex-col gap-3">
            {config.replyActions.map((action, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "16px",
                  borderRadius: "14px",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: "rgba(114, 137, 218, 0.2)",
                    color: "var(--nex-aqua)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </div>
                <GripVertical
                  size={18}
                  style={{ color: "var(--nex-muted)", flexShrink: 0 }}
                />
                <GlassInput
                  value={action}
                  onChange={(e) => updateAction(index, e.target.value)}
                  placeholder={`/action ${index + 1}`}
                  style={{
                    flex: 1,
                    fontFamily: "monospace",
                    fontSize: 14,
                  }}
                />
                <button
                  onClick={() => removeAction(index)}
                  className="r-btn r-btn-ghost p-2"
                  style={{ 
                    color: "#ef4444", 
                    borderRadius: "10px",
                    padding: "10px",
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          {config.replyActions.length === 0 && (
            <div
              className="text-center py-12 rounded-xl"
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "2px dashed rgba(255, 255, 255, 0.06)",
              }}
            >
              <MessageSquare
                size={36}
                style={{ color: "var(--nex-muted)", opacity: 0.3, margin: "0 auto 14px" }}
              />
              <p className="text-sm" style={{ color: "var(--nex-muted)" }}>
                No reply actions yet. Add one using the button above or quick chips.
              </p>
            </div>
          )}
        </div>

        {/* Preset Management */}
        <div
          style={{
            padding: "24px",
            background: "rgba(255, 255, 255, 0.02)",
            borderRadius: "16px",
            border: "1px solid rgba(255, 255, 255, 0.05)",
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <span className="text-sm font-semibold" style={{ color: "var(--nex-text)" }}>
              Action Presets
            </span>
            <button
              onClick={() => setShowPresetInput(!showPresetInput)}
              className="r-btn r-btn-ghost"
              style={{ padding: "8px 16px", fontSize: 13 }}
            >
              <FolderOpen size={15} />
              {showPresetInput ? "Cancel" : "Save New"}
            </button>
          </div>

          {showPresetInput && (
            <div className="mb-5">
              <div className="flex gap-4">
                <GlassInput
                  placeholder="Preset name..."
                  value={config.presetName}
                  onChange={(e) => updateField("presetName", e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={savePreset}
                  disabled={!config.presetName.trim() || config.replyActions.length === 0}
                  className="r-btn r-btn-primary"
                  style={{ padding: "14px 20px" }}
                >
                  <Save size={15} />
                </button>
              </div>
            </div>
          )}

          {savedPresets.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {savedPresets.map((preset) => (
                <div
                  key={preset.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 14px",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    borderRadius: "10px",
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "var(--nex-text)" }}>{preset.name}</span>
                  <button
                    onClick={() => loadPreset(preset)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--nex-aqua)",
                      padding: 4,
                    }}
                  >
                    <Star size={14} />
                  </button>
                  <button
                    onClick={() => deletePreset(preset.name)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#ef4444",
                      padding: 4,
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {savedPresets.length === 0 && !showPresetInput && (
            <div className="text-sm" style={{ color: "var(--nex-muted)" }}>
              No saved presets. Save your current actions as a preset for quick access.
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

// ============================================================================
// Step 5: Review & Launch
// ============================================================================

interface Step5Props {
  config: BotConfig;
  isLaunching: boolean;
  launchSuccess: boolean;
  deployError?: string;
  dockerAvailable: boolean;
  onLaunch: () => void;
}

function Step5Review({
  config,
  isLaunching,
  launchSuccess,
  deployError,
  dockerAvailable,
  onLaunch,
}: Step5Props) {
  const t = useT();

  const summaryItems = [
    {
      icon: Bot,
      label: "Bot Name",
      value: config.name || "Unnamed",
    },
    {
      icon: Server,
      label: "Server",
      value: `${config.serverHost}:${config.serverPort}`,
    },
    {
      icon: Gamepad2,
      label: "Version",
      value: `Minecraft ${config.mcVersion}`,
    },
    {
      icon: Shield,
      label: "Auth Mode",
      value: config.authMode.charAt(0).toUpperCase() + config.authMode.slice(1),
    },
    {
      icon: MessageSquare,
      label: "Message Interval",
      value: config.messageInterval > 0 ? `${config.messageInterval}s` : "Disabled",
    },
    {
      icon: Clock,
      label: "AFK Detection",
      value: config.afkEnabled ? `Every ${config.afkInterval}s` : "Disabled",
    },
    {
      icon: Wifi,
      label: "Reconnect Delay",
      value: `${config.reconnectDelay}s`,
    },
    {
      icon: Zap,
      label: "Reply Actions",
      value: `${config.replyActions.length} configured`,
    },
  ];

  return (
    <div style={{ animation: "fadeUp 0.4s ease", position: "relative" }}>
      {launchSuccess && <Confetti />}

      {launchSuccess ? (
        <div className="text-center py-16">
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: `
                linear-gradient(135deg, 
                  rgba(34, 197, 94, 0.2) 0%, 
                  rgba(34, 197, 94, 0.05) 100%
                )
              `,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 28px",
              border: "3px solid rgba(34, 197, 94, 0.3)",
              boxShadow: "0 0 80px rgba(34, 197, 94, 0.3)",
              animation: "pulse-ring 1.5s ease-out infinite",
            }}
          >
            <Check size={56} style={{ color: "#22c55e" }} />
          </div>
          <h4
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: "var(--nex-text)",
              margin: "0 0 16px 0",
              letterSpacing: "-0.02em",
            }}
          >
            Bot Deployed!
          </h4>
          <p style={{ color: "var(--nex-muted)", fontSize: 16, margin: 0 }}>
            Your bot "{config.name}" is now starting up.
          </p>
        </div>
      ) : (
        <>
          <GlassCard>
            <div className="flex items-center gap-5 mb-8">
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: `
                    linear-gradient(135deg, 
                      rgba(114, 137, 218, 0.35) 0%, 
                      rgba(114, 137, 218, 0.12) 100%
                    )
                  `,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(114, 137, 218, 0.3)",
                  boxShadow: "0 8px 32px rgba(114, 137, 218, 0.2)",
                }}
              >
                <Sparkles size={26} style={{ color: "var(--nex-aqua)" }} />
              </div>
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--nex-text)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Review & Launch
                </h3>
                <p style={{ margin: 0, fontSize: 14, color: "var(--nex-muted)" }}>
                  Verify your settings and deploy your bot.
                </p>
              </div>
            </div>

            {/* Summary Grid */}
            <div
              className="grid grid-cols-2 gap-4 p-5 rounded-2xl"
              style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              {summaryItems.map((item, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: "rgba(114, 137, 218, 0.12)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <item.icon size={16} style={{ color: "var(--nex-aqua)" }} />
                  </div>
                  <div>
                    <div 
                      className="text-xs uppercase tracking-wider font-semibold" 
                      style={{ color: "var(--nex-muted)" }}
                    >
                      {item.label}
                    </div>
                    <div
                      className="text-sm font-medium truncate max-w-[160px]"
                      style={{ color: "var(--nex-text)" }}
                    >
                      {item.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>

          {/* Deploy Error Display */}
          {deployError && (
            <div
              className="flex items-start gap-4 mt-5 p-5 rounded-xl"
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
              }}
            >
              <AlertCircle size={22} style={{ color: "#ef4444", flexShrink: 0 }} />
              <div>
                <div
                  className="font-semibold text-sm mb-2"
                  style={{ color: "#ef4444" }}
                >
                  Deployment Failed
                </div>
                <div className="text-sm" style={{ color: "var(--nex-muted)" }}>
                  {deployError}
                </div>
              </div>
            </div>
          )}

          {/* Docker Warning */}
          {!dockerAvailable && !deployError && (
              <div
                className="flex items-start gap-4 mt-5 p-5 rounded-xl"
                style={{
                  background: "rgba(245, 158, 11, 0.08)",
                  border: "1px solid rgba(245, 158, 11, 0.2)",
                }}
              >
                <AlertCircle size={22} style={{ color: "#f59e0b", flexShrink: 0 }} />
                <div>
                  <div
                    className="font-semibold text-sm mb-2"
                    style={{ color: "#f59e0b" }}
                  >
                    Docker Unavailable
                  </div>
                  <div className="text-sm" style={{ color: "var(--nex-muted)" }}>
                    The deployment system is currently unavailable. Your bot will be queued
                    and started automatically when Docker becomes available.
                  </div>
                </div>
              </div>
            )}
          </GlassCard>

          {/* Launch Button */}
          <button
            onClick={onLaunch}
            disabled={isLaunching}
            className="r-btn r-btn-primary w-full mt-6"
            style={{
              padding: "20px 28px",
              fontSize: 16,
              fontWeight: 700,
              borderRadius: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              boxShadow: "0 8px 40px rgba(114, 137, 218, 0.35)",
            }}
          >
            {isLaunching ? (
              <>
                <Loader2 size={24} style={{ animation: "ac-spin 1s linear infinite" }} />
                Launching Bot...
              </>
            ) : (
              <>
                <Play size={24} />
                Launch Bot
              </>
            )}
          </button>

          <div
            className="text-center mt-5 text-sm"
            style={{ color: "var(--nex-muted)" }}
          >
            By launching, you agree to our Terms of Service and usage policies.
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Main DeployBotWizard Component
// ============================================================================

export function DeployBotWizard({ open, onClose, onDeployed, openWithDefaults }: WizardProps) {
  const t = useT();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [dockerAvailable, setDockerAvailable] = useState(true);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [config, setConfig] = useState<BotConfig>(() => ({
    name: openWithDefaults?.name ?? "",
    serverHost: openWithDefaults?.serverHost ?? "",
    serverPort: openWithDefaults?.serverPort ?? 25565,
    mcVersion: openWithDefaults?.mcVersion ?? "1.21.1",
    description: openWithDefaults?.description ?? "",
    authMode: openWithDefaults?.authMode ?? "microsoft",
    accessToken: openWithDefaults?.accessToken ?? "",
    mcUsername: openWithDefaults?.mcUsername ?? "",
    uuid: openWithDefaults?.uuid ?? "",
    ssid: openWithDefaults?.ssid ?? "",
    message: openWithDefaults?.message ?? "",
    messageInterval: openWithDefaults?.messageInterval ?? 5,
    afkEnabled: openWithDefaults?.afkEnabled ?? false,
    afkInterval: openWithDefaults?.afkInterval ?? 30,
    reconnectDelay: openWithDefaults?.reconnectDelay ?? 5,
    inactivityTimeout: openWithDefaults?.inactivityTimeout ?? 0,
    smartAfk: openWithDefaults?.smartAfk ?? false,
    replyMessage: openWithDefaults?.replyMessage ?? "",
    triggerKeyword: openWithDefaults?.triggerKeyword ?? "",
    replyDelay: openWithDefaults?.replyDelay ?? 0,
    cooldown: openWithDefaults?.cooldown ?? 30,
    replyActions: openWithDefaults?.replyActions ?? [],
    presetName: openWithDefaults?.presetName ?? "",
    selectedPreset: openWithDefaults?.selectedPreset ?? "",
  }));

  const totalSteps = 5;
  const stepLabels = ["Setup", "Auth", "Behavior", "Replies", "Launch"];

  const validateStep = useCallback(
    (step: number): boolean => {
      const newErrors: ValidationErrors = {};

      if (step === 1) {
        if (!config.name.trim()) {
          newErrors.name = "Bot name is required";
        }
        if (!config.serverHost.trim()) {
          newErrors.serverHost = "Server host is required";
        }
      }

      if (step === 2) {
        if (config.authMode === "microsoft" && !config.accessToken.trim()) {
          newErrors.accessToken = "Access token is required for Microsoft auth";
        }
        if (config.authMode === "offline" && !config.mcUsername.trim()) {
          newErrors.mcUsername = "Username is required for offline mode";
        }
        if (config.authMode === "ssid" && !config.ssid.trim()) {
          newErrors.ssid = "SSID token is required";
        }
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [config],
  );

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < totalSteps) {
        setCurrentStep(currentStep + 1);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleLaunch = async () => {
    if (!validateStep(currentStep)) return;

    setIsLaunching(true);
    setErrors((prev) => ({ ...prev, deployError: undefined }));

    try {
      const result = await createBot({
        data: {
          name: config.name,
          mcUsername: config.authMode === "offline" ? config.mcUsername : undefined,
          serverHost: config.serverHost,
          serverPort: config.serverPort,
          mcVersion: config.mcVersion,
          authMode: config.authMode,
          accessToken: config.accessToken || undefined as string | undefined,
          ssid: config.ssid || undefined,
          uuid: config.uuid || undefined,
          proxy: undefined,
          message: config.message || undefined,
          reply: config.replyMessage ? [config.replyMessage] : undefined,
          replyActions: config.replyActions.length > 0 ? config.replyActions : undefined,
          triggerKeyword: config.triggerKeyword || undefined,
          webhookUrl: undefined,
          messageInterval: Math.round(config.messageInterval),
          replyDelay: config.replyDelay > 0 ? config.replyDelay : undefined,
          replyCooldown: config.cooldown > 0 ? config.cooldown : undefined,
          afkInterval: config.afkEnabled ? config.afkInterval : undefined,
          reconnectDelay: config.reconnectDelay,
          inactivityTimeout: config.inactivityTimeout > 0 ? config.inactivityTimeout : undefined,
        },
      });

      setLaunchSuccess(true);
      setDockerAvailable(true);

      if (onDeployed && result.bot?.id) {
        setTimeout(() => {
          onDeployed(result.bot.id);
          onClose();
        }, 3000);
      }
    } catch (error) {
      console.error("Failed to deploy bot:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to deploy bot. Please try again.";
      setErrors((prev) => ({ ...prev, deployError: errorMessage }));
      setDockerAvailable(false);
    } finally {
      setIsLaunching(false);
    }
  };

  const canGoNext = () => {
    if (currentStep === 1) {
      return config.name.trim() && config.serverHost.trim();
    }
    if (currentStep === 2) {
      if (config.authMode === "microsoft") return true;
      if (config.authMode === "offline") return config.mcUsername.trim();
      if (config.authMode === "ssid") return config.ssid.trim();
    }
    return true;
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(24px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 680,
          maxHeight: "92vh",
          overflow: "auto",
          background: "var(--nex-surface)",
          borderRadius: "28px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: `
            0 0 0 1px rgba(255, 255, 255, 0.05) inset,
            0 40px 80px -12px rgba(0, 0, 0, 0.6),
            0 0 100px -20px rgba(114, 137, 218, 0.2)
          `,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "32px 32px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
            background: `
              linear-gradient(165deg, 
                rgba(114, 137, 218, 0.1) 0%, 
                rgba(114, 137, 218, 0.03) 40%,
                transparent 100%
              )
            `,
          }}
        >
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-5">
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 18,
                  background: `
                    linear-gradient(135deg, 
                      rgba(114, 137, 218, 0.45) 0%, 
                      rgba(114, 137, 218, 0.18) 100%
                    )
                  `,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(114, 137, 218, 0.35)",
                  boxShadow: "0 12px 40px rgba(114, 137, 218, 0.3)",
                }}
              >
                <Bot size={30} style={{ color: "var(--nex-aqua)" }} />
              </div>
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 24,
                    fontWeight: 800,
                    color: "var(--nex-text)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Deploy New Bot
                </h2>
                <div
                  className="text-sm mt-1"
                  style={{ color: "var(--nex-muted)" }}
                >
                  Step {currentStep} of {totalSteps}: {stepLabels[currentStep - 1]}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="r-btn r-btn-ghost"
              style={{ 
                padding: 12, 
                borderRadius: 14,
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Step Progress */}
          <StepProgress
            currentStep={currentStep}
            totalSteps={totalSteps}
            stepLabels={stepLabels}
          />
        </div>

        {/* Step Content */}
        <div style={{ padding: "32px", minHeight: 480 }}>
          {currentStep === 1 && (
            <Step1BotSetup config={config} setConfig={setConfig} errors={errors} />
          )}
          {currentStep === 2 && (
            <Step2Authentication config={config} setConfig={setConfig} errors={errors} />
          )}
          {currentStep === 3 && <Step3Behavior config={config} setConfig={setConfig} />}
          {currentStep === 4 && <Step4ReplyActions config={config} setConfig={setConfig} />}
          {currentStep === 5 && (
            <Step5Review
              config={config}
              isLaunching={isLaunching}
              launchSuccess={launchSuccess}
              deployError={errors.deployError}
              dockerAvailable={dockerAvailable}
              onLaunch={handleLaunch}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        {!launchSuccess && (
          <div
            style={{
              padding: "24px 32px 32px",
              display: "flex",
              gap: "16px",
              borderTop: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            {currentStep > 1 && (
              <button
                onClick={handleBack}
                className="r-btn r-btn-outline"
                style={{
                  padding: "16px 24px",
                  borderRadius: "16px",
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                }}
              >
                <ChevronLeft size={18} />
                Back
              </button>
            )}
            {currentStep < totalSteps && (
              <button
                onClick={handleNext}
                disabled={!canGoNext()}
                className="r-btn r-btn-primary"
                style={{
                  padding: "16px 28px",
                  borderRadius: "16px",
                  flex: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                }}
              >
                Next
                <ChevronRight size={18} />
              </button>
            )}
          </div>
        )}

        {launchSuccess && (
          <div style={{ padding: "0 32px 32px" }}>
            <button
              onClick={onClose}
              className="r-btn r-btn-outline w-full"
              style={{
                padding: "16px 24px",
                borderRadius: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default DeployBotWizard;
