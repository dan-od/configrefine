const DEBUG = typeof window !== "undefined" && window.CR_DEBUG;

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function pooledExec(tasks, { concurrency = 6, signal, onSettled } = {}) {
  const results = [];
  const executing = new Set();
  let settled = 0;

  for (let i = 0; i < tasks.length; i++) {
    if (signal?.aborted) {
      for (let j = i; j < tasks.length; j++) {
        const r = { index: j, status: "cancelled", reason: "Cancelled" };
        results[j] = r;
        onSettled?.(r, ++settled, tasks.length);
      }
      break;
    }

    const idx = i;
    const p = (async () => {
      try {
        const value = await tasks[idx](signal);
        const r = { index: idx, status: "fulfilled", value };
        results[idx] = r;
        if (DEBUG) console.log(`[pool] task ${idx} done`);
        onSettled?.(r, ++settled, tasks.length);
      } catch (e) {
        const cancelled = signal?.aborted || e.name === "AbortError";
        const r = {
          index: idx,
          status: cancelled ? "cancelled" : "rejected",
          reason: e.message || String(e),
        };
        results[idx] = r;
        if (DEBUG) console.log(`[pool] task ${idx} ${r.status}: ${r.reason}`);
        onSettled?.(r, ++settled, tasks.length);
      }
    })();

    executing.add(p);
    p.then(() => executing.delete(p));

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}
