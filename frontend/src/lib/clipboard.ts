/**
 * Copy text to the clipboard with a fallback for insecure contexts.
 *
 * `navigator.clipboard.writeText` is only available in a secure context
 * (HTTPS or `localhost`). TravStats runs inside a LAN on plain HTTP in
 * typical deployments, so we fall back to the legacy
 * `document.execCommand("copy")` path via a hidden textarea when the
 * modern API is unavailable or rejected.
 *
 * Throws if both paths fail. The UI layer catches and shows a toast.
 */
export async function copyToClipboard(text: string): Promise<void> {
  // Modern path — only works in secure contexts.
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }

  // Legacy path — works on plain HTTP.
  if (typeof document === "undefined") {
    throw new Error("clipboard: no document available");
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  // Off-screen but still in the layout so the browser treats it as selectable.
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.setAttribute("readonly", "");
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error("clipboard: execCommand copy returned false");
  }
}
