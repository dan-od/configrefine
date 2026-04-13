import { useTheme } from "../theme";

/**
 * Mobile-only bottom sheet — slides up from above the bottom nav.
 * The backdrop tap dismisses the sheet via onClose.
 */
export function BottomSheet({ onClose, children }) {
  const { C } = useTheme();
  return (
    <>
      {/* Backdrop — stops at the bottom nav top edge */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, bottom: 56,
          background: "rgba(0,0,0,0.5)", zIndex: 90,
        }}
      />
      {/* Sheet */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 56,
        maxHeight: "75vh", overflowY: "auto",
        background: C.surface, borderTop: `1px solid ${C.borderActive}`,
        borderRadius: "12px 12px 0 0", padding: 16, zIndex: 91,
      }}>
        {/* Drag handle */}
        <div style={{
          width: 32, height: 4, background: C.muted + "66",
          borderRadius: 2, margin: "0 auto 12px",
        }} />
        {children}
      </div>
    </>
  );
}
