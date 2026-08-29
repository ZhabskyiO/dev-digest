import type { CiArchiveResult } from "@/lib/hooks/ci";

/**
 * Decodes the archive's base64 payload into a Blob and triggers a normal
 * browser download (AC-31's "download files" method) — no new network call,
 * the bytes already arrived via `useCiArchive`'s single `apiFetch` call.
 */
export function downloadArchive({ filename, content_base64 }: CiArchiveResult): void {
  const binary = atob(content_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
