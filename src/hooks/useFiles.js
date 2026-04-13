import { useState, useCallback } from "react";
import { SAMPLE } from "../engine";

const detectName = (text) => { const m = text.match(/^hostname\s+(\S+)/m); return m ? m[1] : ""; };
const makeId = () => Math.random().toString(36).slice(2, 8);
export const makeFile = (name, raw) => ({ id: makeId(), name: name || detectName(raw) || "config", raw, clean: "" });

/**
 * Manages the list of loaded config files and the active tab selection.
 * Deduplicates by name — uploading the same hostname replaces the existing entry.
 */
export function useFiles() {
  const [files, setFiles] = useState([]);
  const [activeId, setActiveId] = useState(null);

  const active = files.find(f => f.id === activeId) ?? null;

  const updateFile = useCallback((id, updates) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, []);

  // Merge new files in — deduplicates by name
  const addFiles = useCallback((newFiles) => {
    setFiles(prev => {
      const merged = [...prev];
      for (const nf of newFiles) {
        const idx = merged.findIndex(f => f.name === nf.name);
        if (idx >= 0) merged[idx] = { ...merged[idx], raw: nf.raw, clean: "" };
        else merged.push(nf);
      }
      return merged;
    });
    if (newFiles.length > 0) setActiveId(prev => prev ?? newFiles[0].id);
  }, []);

  // Handle <input type="file"> change events (multi-file)
  const handleUpload = useCallback((e) => {
    const uploaded = Array.from(e.target.files ?? []);
    if (!uploaded.length) return;
    Promise.all(uploaded.map(f => new Promise(resolve => {
      const r = new FileReader();
      r.onload = ev => {
        const text = ev.target.result;
        resolve(makeFile(detectName(text) || f.name.replace(/\.[^.]+$/, ""), text));
      };
      r.readAsText(f);
    }))).then(newFiles => {
      addFiles(newFiles);
      setActiveId(newFiles[0].id);
    });
    e.target.value = "";
  }, [addFiles]);

  const loadSample = useCallback(() => {
    const f = makeFile("", SAMPLE);
    addFiles([f]);
    setActiveId(f.id);
  }, [addFiles]);

  const closeTab = useCallback((id) => {
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (activeId === id) setActiveId(next.length ? next[0].id : null);
      return next;
    });
  }, [activeId]);

  const reset = useCallback(() => { setFiles([]); setActiveId(null); }, []);

  // Called by LabPanel when configs are pulled from devices
  const loadLabConfig = useCallback((configs, deviceName) => {
    if (deviceName && configs[deviceName]) {
      const f = makeFile(deviceName, configs[deviceName]);
      addFiles([f]);
      setActiveId(f.id);
    } else if (configs && !deviceName) {
      const newFiles = Object.entries(configs).map(([name, raw]) => makeFile(name, raw));
      addFiles(newFiles);
      if (newFiles.length) setActiveId(newFiles[0].id);
    }
  }, [addFiles]);

  return {
    files, setFiles, activeId, setActiveId, active,
    updateFile, addFiles, handleUpload, loadSample,
    closeTab, reset, loadLabConfig,
  };
}
