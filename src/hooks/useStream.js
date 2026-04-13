import { useState } from "react";

/**
 * Shared streaming hook for pull and push progress.
 * Handles chunked JSON lines from the backend, with error recovery
 * when the stream breaks mid-transfer.
 *
 * @param {"pull"|"push"} action  Determines verb strings in status messages.
 */
export function useStream(action) {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState(null);
  const [pulling, setPulling] = useState(null);

  const verb = action === "push" ? "Pushing to" : action === "erase" ? "Erasing" : "Pulling";
  const past = action === "push" ? "Pushed" : action === "erase" ? "Erased" : "Pulled";

  const initResults = (total) => {
    setResults({ configs: {}, pulled: 0, total, errors: [] });
    setPulling(null);
    setStatus("pulling");
  };

  const reset = () => {
    setStatus("idle");
    setMessage("");
    setResults(null);
    setPulling(null);
  };

  const readStream = async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }

          if (msg.type === "status") {
            setMessage(msg.message);
          } else if (msg.type === "pulling") {
            setPulling(msg.device);
            setMessage(`${verb} ${msg.device}...`);
          } else if (msg.type === "device") {
            setPulling(null);
            const info = msg.pushed ? `${msg.pushed} lines pushed` : msg.config;
            const errs = msg.errors?.length ? ` (${msg.errors.length} error${msg.errors.length > 1 ? "s" : ""})` : "";
            setResults(prev => ({
              ...prev,
              configs: { ...prev.configs, [msg.name]: info },
              pulled: (prev?.pulled ?? 0) + 1,
              deviceErrors: {
                ...(prev?.deviceErrors ?? {}),
                ...(msg.errors?.length ? { [msg.name]: msg.errors } : {}),
              },
            }));
            setMessage(`${past} ${msg.name}${errs}`);
          } else if (msg.type === "device_error") {
            setPulling(null);
            setResults(prev => ({
              ...prev,
              errors: [...(prev?.errors ?? []), msg.name || msg.device],
            }));
            setMessage(`Failed: ${msg.name || msg.device}`);
          } else if (msg.type === "error") {
            setStatus("error");
            setMessage(msg.message || "Unknown error");
          } else if (msg.type === "done") {
            setPulling(null);
            setStatus("done");
            setMessage(`Done — ${msg.pulled}/${msg.total} ${past.toLowerCase()}`);
          }
        }
      }
    } catch (e) {
      // Stream broke mid-transfer (network drop, backend crash, etc.)
      setStatus("error");
      setMessage("Connection interrupted — partial results may be available. Please retry.");
      setPulling(null);
    }
  };

  const busy = status === "discovering" || status === "pulling";

  return { status, setStatus, message, setMessage, results, pulling, busy, readStream, reset, initResults };
}
