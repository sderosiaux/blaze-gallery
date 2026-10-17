/** Clipboard API first; the hidden-textarea fallback covers plain-http hosts where it is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    // Missing on plain-http hosts, whatever the DOM typings say.
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    if (clipboard && window.isSecureContext) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
