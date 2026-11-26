/**
 * Download helpers.
 * JSZip is lazily imported — it's ~100 kB and only needed for batch download.
 */

export function downloadSingle(name, content) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  a.download = `${name}.txt`;
  a.click();
}

export async function downloadIndividually(files) {
  const cleaned = files.filter(f => f.clean);
  for (const f of cleaned) {
    downloadSingle(f.name, f.clean);
    await new Promise(r => setTimeout(r, 400));
  }
}

export async function downloadBackupZip(configs) {
  const entries = Object.entries(configs).filter(([, v]) => v);
  if (!entries.length) return;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  entries.forEach(([name, content]) => zip.file(`${name}.txt`, content));
  const blob = await zip.generateAsync({ type: "blob" });
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup-${stamp}.zip`;
  a.click();
}

export async function downloadAllZip(files) {
  const cleaned = files.filter(f => f.clean);
  if (!cleaned.length) return;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  cleaned.forEach(f => zip.file(`${f.name}.txt`, f.clean));
  const blob = await zip.generateAsync({ type: "blob" });
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `configs-${stamp}.zip`;
  a.click();
}
