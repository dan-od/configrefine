import { useCallback, useRef, useEffect } from "react";

const WORKSPACE_PREFIX = "configrefine_workspace_";
const CONNECTION_KEY = "configrefine_connection";
const PULL_PREFIX = "configrefine_pull_";
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function safeGet(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed._ts && Date.now() - parsed._ts > EXPIRY_MS) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function safeSet(storage, key, value) {
  try { storage.setItem(key, JSON.stringify({ ...value, _ts: Date.now() })); } catch {}
}

function workspaceKey(podId) {
  return WORKSPACE_PREFIX + (podId || "default");
}

function pullKey(podId) {
  return PULL_PREFIX + (podId || "default");
}

export function useSessionPersistence() {
  const debounceRef = useRef(null);

  const saveConnection = useCallback((params) => {
    if (!params) { sessionStorage.removeItem(CONNECTION_KEY); return; }
    safeSet(sessionStorage, CONNECTION_KEY, {
      mode: params.mode,
      host: params.host,
      port: params.port,
      podId: params.podId,
      podName: params.podName,
      username: params.username,
    });
  }, []);

  const loadConnection = useCallback(() => {
    return safeGet(sessionStorage, CONNECTION_KEY);
  }, []);

  const clearConnection = useCallback(() => {
    sessionStorage.removeItem(CONNECTION_KEY);
  }, []);

  const saveWorkspace = useCallback((podId, data) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      safeSet(localStorage, workspaceKey(podId), data);
    }, 500);
  }, []);

  const loadWorkspace = useCallback((podId) => {
    return safeGet(localStorage, workspaceKey(podId));
  }, []);

  const clearWorkspace = useCallback((podId) => {
    localStorage.removeItem(workspaceKey(podId));
  }, []);

  const savePullResults = useCallback((podId, results) => {
    safeSet(localStorage, pullKey(podId), results);
  }, []);

  const loadPullResults = useCallback((podId) => {
    return safeGet(localStorage, pullKey(podId));
  }, []);

  const clearPullResults = useCallback((podId) => {
    localStorage.removeItem(pullKey(podId));
  }, []);

  // Cleanup expired entries on mount
  useEffect(() => {
    try {
      const now = Date.now();
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(WORKSPACE_PREFIX) || key?.startsWith(PULL_PREFIX)) {
          try {
            const val = JSON.parse(localStorage.getItem(key));
            if (val?._ts && now - val._ts > EXPIRY_MS) localStorage.removeItem(key);
          } catch { localStorage.removeItem(key); }
        }
      }
    } catch {}
  }, []);

  return {
    saveConnection, loadConnection, clearConnection,
    saveWorkspace, loadWorkspace, clearWorkspace,
    savePullResults, loadPullResults, clearPullResults,
  };
}
