import { useState, useEffect } from "react";

// ── Color tokens ──
export const C = {
  bg: "#080c18", surface: "#0d1425", raised: "#111b32",
  border: "rgba(255,255,255,0.06)", borderActive: "rgba(232,178,80,0.35)",
  accent: "#e8b250", accentDim: "rgba(232,178,80,0.12)", accentGlow: "rgba(232,178,80,0.2)",
  green: "#34d399", greenDim: "rgba(52,211,153,0.1)",
  muted: "#4b5c7a", text: "#c8d6e8", textBright: "#eaf0f8", red: "#f87171"
};

// ── Font stacks ──
export const mono = "'JetBrains Mono',ui-monospace,monospace";
export const sans = "'Inter',system-ui,-apple-system,sans-serif";

// ── Responsive hook ──
export function useViewport() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return { w, phone: w < 640, tablet: w < 1024, desktop: w >= 1024 };
}
