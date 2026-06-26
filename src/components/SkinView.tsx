import { useState } from "react";

// Renders a Minecraft player skin as a pre-rendered 2D bust from mc-api.io.
// We deliberately use a plain <img> (not skinview3d/WebGL): a rendered image
// loads cross-origin without CORS, whereas drawing a skin texture to a WebGL
// canvas requires CORS headers that the skin mirrors don't send.

interface SkinViewProps {
  /** Minecraft username — bust is rendered by mc-api.io. */
  username: string;
  size?: number;
  className?: string;
}

const FALLBACK_USER = "MHF_Steve";

function bustUrl(user: string, size: number): string {
  return `https://mc-api.io/render/bust/${encodeURIComponent(user)}/java?size=${size}`;
}

export function SkinView({ username, size = 160, className }: SkinViewProps) {
  // Bump device pixel ratio so the render stays crisp on retina displays.
  const renderSize = Math.min(512, Math.round(size * 2));
  const [failed, setFailed] = useState(false);

  const user = !failed && username ? username : FALLBACK_USER;

  return (
    <img
      src={bustUrl(user, renderSize)}
      width={size}
      height={size}
      loading="lazy"
      onError={() => {
        // Unknown/offline account → fall back to the default Steve render once.
        if (!failed) setFailed(true);
      }}
      className={className}
      alt={`Minecraft skin preview for ${username || "default player"}`}
      style={{ imageRendering: "auto", objectFit: "contain" }}
    />
  );
}
