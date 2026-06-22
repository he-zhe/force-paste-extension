chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen" || message?.type !== "READ_CLIPBOARD_TEXT") {
    return false;
  }

  readClipboardText()
    .then((text) => sendResponse({ ok: true, text }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function readClipboardText() {
  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      const fallback = readClipboardTextWithExecCommand();
      if (fallback.ok) {
        return fallback.text;
      }
      throw new Error(`${error.message}; fallback failed: ${fallback.error}`);
    }
  }

  const fallback = readClipboardTextWithExecCommand();
  if (fallback.ok) {
    return fallback.text;
  }

  throw new Error(fallback.error);
}

function readClipboardTextWithExecCommand() {
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const didPaste = document.execCommand("paste");
    return didPaste
      ? { ok: true, text: textarea.value }
      : { ok: false, error: "document.execCommand('paste') returned false." };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    textarea.remove();
  }
}
