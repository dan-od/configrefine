/**
 * Web Worker — runs the cleanup engine off the main thread so the UI
 * stays responsive even when processing very large configs.
 */
import { runCleanup } from "../engine.js";

self.onmessage = ({ data: { id, text, opts } }) => {
  try {
    const result = runCleanup(text, opts);
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e.message ?? String(e) });
  }
};
