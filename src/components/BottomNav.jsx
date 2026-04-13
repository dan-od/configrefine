import { Terminal, Settings2, Wifi, Play, Check, Loader } from "lucide-react";
import { useTheme, mono } from "../theme";

/**
 * Fixed 56px bottom navigation bar — mobile only.
 * Tabs: WORK (workspace) · RULES (bottom sheet) · SSH (bottom sheet) · GO (process action)
 */
export function BottomNav({ mobileTab, setMobileTab, processing, done, onGo }) {
  const { C } = useTheme();

  const GoIcon = processing ? Loader : done ? Check : Play;
  const goColor = done ? C.green : C.accent;
  const goLabel = processing ? "..." : done ? "DONE" : "GO";

  const navTabs = [
    { id: "work",  label: "WORK",  Icon: Terminal  },
    { id: "rules", label: "RULES", Icon: Settings2 },
    { id: "ssh",   label: "SSH",   Icon: Wifi      },
  ];

  return (
    <div style={{
      position: "fixed", left: 0, right: 0, bottom: 0,
      height: "calc(56px + env(safe-area-inset-bottom, 0px))",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      background: C.surface, borderTop: `1px solid ${C.border}`,
      display: "flex", alignItems: "stretch", zIndex: 80,
    }}>
      {navTabs.map(({ id, label, Icon }) => {
        const isActive = mobileTab === id;
        return (
          <button
            key={id}
            onClick={() => setMobileTab(id)}
            style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 3, border: "none", background: "transparent",
              cursor: "pointer", color: isActive ? C.accent : C.muted,
              transition: "color .15s",
              // Minimum 44px tap target
              minWidth: 44,
            }}
          >
            <Icon style={{ width: 18, height: 18 }} />
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 1,
              textTransform: "uppercase", fontFamily: mono,
            }}>
              {label}
            </span>
          </button>
        );
      })}

      {/* GO — action button, not a nav tab */}
      <button
        onClick={onGo}
        disabled={processing}
        style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 3, border: "none", background: "transparent",
          cursor: processing ? "default" : "pointer",
          color: goColor, transition: "color .15s",
          minWidth: 44,
        }}
      >
        <GoIcon style={{
          width: 18, height: 18,
          animation: processing ? "spin 1s linear infinite" : "none",
        }} />
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 1,
          textTransform: "uppercase", fontFamily: mono,
        }}>
          {goLabel}
        </span>
      </button>
    </div>
  );
}
