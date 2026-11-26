import { useState, useCallback } from "react";
import { SAMPLE, normalizeNewlines, splitConfigs } from "../engine";

const detectName = (text) => { const m = text.match(/^hostname\s+(\S+)/m); return m ? m[1] : ""; };
const makeId = () => Math.random().toString(36).slice(2, 8);
// Pulled (SSH) and uploaded configs can be CRLF; store everything as LF
export const makeFile = (name, raw) => {
  const text = normalizeNewlines(raw);
  return { id: makeId(), name: name || detectName(text) || "config", raw: text, clean: "" };
};

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

  const [pendingSplit, setPendingSplit] = useState(null);

  const confirmSplit = useCallback((devices) => {
    const newFiles = devices.map(d => makeFile(d.name, d.content));
    addFiles(newFiles);
    if (newFiles.length) setActiveId(newFiles[0].id);
    setPendingSplit(null);
  }, [addFiles]);

  const cancelSplit = useCallback(() => {
    setPendingSplit(null);
  }, []);

  // Handle <input type="file"> change events (multi-file) — runs splitConfigs
  const handleUpload = useCallback((e) => {
    const uploaded = Array.from(e.target.files ?? []);
    if (!uploaded.length) return;
    Promise.all(uploaded.map(f => new Promise(resolve => {
      const r = new FileReader();
      r.onload = ev => resolve({ text: ev.target.result, filename: f.name });
      r.readAsText(f);
    }))).then(results => {
      const allDevices = [];
      let hasWarnings = false;
      for (const { text, filename } of results) {
        const devices = splitConfigs(text, filename);
        for (const d of devices) {
          if (d.warnings.length > 0) hasWarnings = true;
        }
        allDevices.push(...devices);
      }
      if (hasWarnings && allDevices.length > 1) {
        setPendingSplit(allDevices);
      } else {
        const newFiles = allDevices.map(d => makeFile(d.name, d.content));
        addFiles(newFiles);
        if (newFiles.length) setActiveId(newFiles[0].id);
      }
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

  // Called by LabPanel when configs are pulled from devices — runs splitConfigs
  const loadLabConfig = useCallback((configs, deviceName) => {
    if (deviceName && configs[deviceName]) {
      const devices = splitConfigs(configs[deviceName], deviceName);
      const newFiles = devices.map(d => makeFile(d.name, d.content));
      addFiles(newFiles);
      if (newFiles.length) setActiveId(newFiles[0].id);
    } else if (configs && !deviceName) {
      const allDevices = [];
      for (const [name, raw] of Object.entries(configs)) {
        allDevices.push(...splitConfigs(raw, name));
      }
      const newFiles = allDevices.map(d => makeFile(d.name, d.content));
      addFiles(newFiles);
      if (newFiles.length) setActiveId(newFiles[0].id);
    }
  }, [addFiles]);

  return {
    files, setFiles, activeId, setActiveId, active,
    updateFile, addFiles, handleUpload, loadSample,
    closeTab, reset, loadLabConfig,
    pendingSplit, confirmSplit, cancelSplit,
  };
}
