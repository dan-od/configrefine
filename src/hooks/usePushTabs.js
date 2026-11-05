import { useState, useCallback } from "react";

const genId = () => Math.random().toString(36).slice(2, 8);

function makeTab(overrides) {
  return {
    id: genId(),
    name: "New tab",
    content: "",
    deviceNum: "",
    deviceTarget: "",
    status: "pending",
    ...overrides,
  };
}

export function usePushTabs() {
  const [tabs, setTabs] = useState(() => [makeTab()]);
  const [activeId, setActiveId] = useState(null);
  const [lastPush, setLastPush] = useState(null);

  const resolved = activeId && tabs.some(t => t.id === activeId) ? activeId : tabs[0]?.id;
  const active = tabs.find(t => t.id === resolved) || null;

  const addTab = useCallback(() => {
    const t = makeTab();
    setTabs(p => [...p, t]);
    setActiveId(t.id);
    return t.id;
  }, []);

  const closeTab = useCallback((id) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const t = makeTab();
        setActiveId(t.id);
        return [t];
      }
      setActiveId(a => {
        if (a !== id) return a;
        return next[Math.min(idx, next.length - 1)].id;
      });
      return next;
    });
  }, []);

  const updateTab = useCallback((id, updates) => {
    setTabs(p => p.map(t => {
      if (t.id !== id) return t;
      const merged = { ...t, ...updates };
      if ("content" in updates) {
        const newHost = updates.content.match(/^hostname\s+(\S+)/m)?.[1];
        const prevHost = t.content.match(/^hostname\s+(\S+)/m)?.[1];
        if (newHost && (t.name === "New tab" || t.name === prevHost)) {
          merged.name = newHost;
        }
      }
      return merged;
    }));
  }, []);

  const clearTab = useCallback((id) => {
    setTabs(p => p.map(t => t.id === id ? { ...t, content: "" } : t));
  }, []);

  const importConfigs = useCallback((configs) => {
    if (!configs.length) return;
    const newTabs = configs.map(c => makeTab({
      name: c.name || "New tab",
      content: c.content || "",
      deviceNum: c.deviceNum || "",
      deviceTarget: c.deviceTarget || "",
    }));
    setTabs(p => {
      const kept = p.filter(t => t.content.trim());
      return kept.length ? [...kept, ...newTabs] : newTabs;
    });
    setActiveId(newTabs[0].id);
  }, []);

  const resetStatuses = useCallback(() => {
    setTabs(p => p.map(t => ({ ...t, status: "pending" })));
  }, []);

  return {
    tabs, active, activeId: resolved, setActiveId,
    addTab, closeTab, updateTab, clearTab, importConfigs, resetStatuses,
    lastPush, setLastPush, setTabs,
  };
}
