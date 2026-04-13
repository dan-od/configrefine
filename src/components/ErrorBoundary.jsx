import { Component } from "react";

/**
 * Global error boundary. Catches uncaught render errors and shows a
 * plain recovery UI instead of a blank screen.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ConfigRefine] Uncaught render error:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 16, background: "#080c18", color: "#c8d6e8",
        fontFamily: "ui-monospace,monospace", padding: 32, textAlign: "center",
      }}>
        <div style={{ fontSize: 32 }}>⚠</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#eaf0f8" }}>Something went wrong</div>
        <pre style={{
          fontSize: 10, color: "#f87171", background: "#0d1425",
          padding: "10px 16px", borderRadius: 4, maxWidth: 600,
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {this.state.error.message}
        </pre>
        <button
          onClick={() => { this.setState({ error: null }); window.location.reload(); }}
          style={{
            padding: "8px 20px", background: "#e8b250", color: "#0a0e1a",
            border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12,
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
