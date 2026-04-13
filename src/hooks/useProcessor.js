import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Runs the cleanup engine in a Web Worker so large configs don't freeze the UI.
 * Falls back gracefully if the Worker API is unavailable (e.g., SSR/test env).
 */
export function useProcessor(files, setFiles, active, updateFile) {
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(null);
  const workerRef = useRef(null);
  const pendingRef = useRef({});

  useEffect(() => {
    // Vite bundles worker files referenced via import.meta.url
    try {
      const w = new Worker(
        new URL("../worker/cleanup.worker.js", import.meta.url),
        { type: "module" },
      );
      w.onmessage = ({ data: { id, result, error } }) => {
        const cb = pendingRef.current[id];
        if (cb) {
          delete pendingRef.current[id];
          cb(result, error);
        }
      };
      workerRef.current = w;
    } catch {
      // Worker unavailable — will fall back to sync execution in runInWorker
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Send one job to the worker; falls back to dynamic import if worker is absent
  const runInWorker = useCallback((text, opts) => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        // Synchronous fallback
        import("../engine.js").then(({ runCleanup }) => {
          try { resolve(runCleanup(text, opts)); }
          catch (e) { reject(e); }
        });
        return;
      }
      const id = Math.random().toString(36).slice(2);
      pendingRef.current[id] = (result, error) => {
        if (error) reject(new Error(error));
        else resolve(result);
      };
      workerRef.current.postMessage({ id, text, opts });
    });
  }, []);

  const processCurrent = useCallback(async (opts) => {
    if (!active) return;
    setProcessing(true);
    try {
      const cleaned = await runInWorker(active.raw, opts);
      updateFile(active.id, { clean: cleaned });
      const rl = active.raw.split("\n").length;
      const cl = cleaned.split("\n").length;
      setDone({ removed: rl - cl, output: cl });
      setTimeout(() => setDone(null), 4000);
    } catch (e) {
      console.error("[useProcessor] processCurrent failed:", e);
    } finally {
      setProcessing(false);
    }
  }, [active, updateFile, runInWorker]);

  const processAll = useCallback(async (opts) => {
    setProcessing(true);
    let totalRemoved = 0, totalOutput = 0;
    try {
      const updated = [];
      for (const f of files) {
        const cleaned = await runInWorker(f.raw, opts);
        totalRemoved += f.raw.split("\n").length - cleaned.split("\n").length;
        totalOutput += cleaned.split("\n").length;
        updated.push({ ...f, clean: cleaned });
      }
      setFiles(updated);
      setDone({ removed: totalRemoved, output: totalOutput, batch: true });
      setTimeout(() => setDone(null), 4000);
    } catch (e) {
      console.error("[useProcessor] processAll failed:", e);
    } finally {
      setProcessing(false);
    }
  }, [files, setFiles, runInWorker]);

  return { processing, done, setDone, processCurrent, processAll };
}
