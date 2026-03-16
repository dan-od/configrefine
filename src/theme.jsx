import { useState, useEffect, createContext, useContext } from "react";

// ── Color palettes ──
const DARK = {
  bg: "#080c18", surface: "#0d1425", raised: "#111b32",
  border: "rgba(255,255,255,0.06)", borderActive: "rgba(232,178,80,0.35)",
  accent: "#e8b250", accentDim: "rgba(232,178,80,0.12)", accentGlow: "rgba(232,178,80,0.2)",
  green: "#34d399", greenDim: "rgba(52,211,153,0.1)",
  muted: "#4b5c7a", text: "#c8d6e8", textBright: "#eaf0f8", red: "#f87171",
};

const LIGHT = {
  bg: "#f4f5f7", surface: "#ffffff", raised: "#eef0f4",
  border: "rgba(0,0,0,0.08)", borderActive: "rgba(180,120,20,0.35)",
  accent: "#b47814", accentDim: "rgba(180,120,20,0.08)", accentGlow: "rgba(180,120,20,0.15)",
  green: "#059669", greenDim: "rgba(5,150,105,0.08)",
  muted: "#8893a7", text: "#3b4255", textBright: "#1a1e2e", red: "#dc2626",
};

// ── Font stacks ──
export const mono = "'JetBrains Mono',ui-monospace,monospace";
export const sans = "'Inter',system-ui,-apple-system,sans-serif";

// ── Theme context ──
const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem("cr-theme") || "dark";
  });

  const toggle = () => setMode(m => {
    const next = m === "dark" ? "light" : "dark";
    localStorage.setItem("cr-theme", next);
    return next;
  });

  const C = mode === "dark" ? DARK : LIGHT;
  return <ThemeCtx.Provider value={{ C, mode, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

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
