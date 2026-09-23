/**
 * 健壮的剪贴板复制——优先用 Clipboard API，失败时 fallback 到 execCommand。
 * Tauri 2 WebView 中 Clipboard API 可能因安全上下文/权限静默失败，
 * execCommand('copy') 兼容性更广。
 */
export async function copyToClipboard(text: string): Promise<void> {
  // 优先尝试 Clipboard API
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fallback 到 execCommand
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  textarea.setAttribute("readonly", "");
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    document.execCommand("copy");
  } catch {
    // 彻底失败，静默
  }
  document.body.removeChild(textarea);
}
