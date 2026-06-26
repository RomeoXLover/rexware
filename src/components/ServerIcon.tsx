import { useState } from "react";
import { Server } from "lucide-react";

// Renders a Minecraft server's favicon (the 64x64 icon shown in the in-game
// server list). We use a plain <img> against the mcsrvstat.us icon endpoint,
// which returns the live server icon as a PNG (or a default pack icon when the
// server has none). Same rationale as SkinView: a rendered image loads
// cross-origin without CORS headers.

interface ServerIconProps {
  host: string;
  port?: number | string;
  size?: number;
  className?: string;
}

function iconUrl(host: string, port?: number | string): string {
  const address =
    port && String(port) !== "25565" ? `${host}:${port}` : host;
  return `https://api.mcsrvstat.us/icon/${encodeURIComponent(address)}`;
}

export function ServerIcon({ host, port, size = 40, className }: ServerIconProps) {
  const [failed, setFailed] = useState(false);
  const trimmed = host?.trim();

  if (!trimmed || failed) {
    return (
      <div
        className={
          className ??
          "grid shrink-0 place-items-center rounded-lg border border-border/50 bg-muted/30 text-muted-foreground"
        }
        style={{ width: size, height: size }}
        aria-label="Minecraft server icon unavailable"
      >
        <Server style={{ width: size * 0.5, height: size * 0.5 }} />
      </div>
    );
  }

  return (
    <img
      src={iconUrl(trimmed, port)}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className ?? "shrink-0 rounded-lg border border-border/50 bg-muted/30"}
      alt={`Server icon for ${trimmed}`}
      style={{ imageRendering: "pixelated", objectFit: "contain" }}
    />
  );
}
