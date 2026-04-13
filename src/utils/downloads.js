/**
 * Download helpers.
 * JSZip is lazily imported — it's ~100 kB and only needed for batch download.
 */

export function downloadSingle(name, content) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  a.download = `${name}-clean.txt`;
  a.click();
}

export async function downloadAllZip(files) {
  const cleaned = files.filter(f => f.clean);
  if (!cleaned.length) return;
  // Lazy-load JSZip only when the user actually requests a zip
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  cleaned.forEach(f => zip.file(`${f.name}-clean.txt`, f.clean));
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "configrefine-cleaned.zip";
  a.click();
}
