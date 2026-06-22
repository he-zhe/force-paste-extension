(() => {
  const loadMarker = Symbol.for("forcePaste.contentLoaded");
  if (globalThis[loadMarker]) {
    return;
  }
  globalThis[loadMarker] = true;

  let lastEditableTarget = null;
  let lastInputSelection = null;
  let lastEditableRange = null;
  let toastTimer = null;

  document.addEventListener("contextmenu", rememberEditableTarget, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "FORCE_PASTE_TEXT") {
      const result = forcePasteText(message.text || "");
      showToast(result.ok ? "Force pasted" : result.error, !result.ok);
      sendResponse(result);
      return false;
    }

    if (message?.type === "FORCE_PASTE_STATUS") {
      showToast(message.text, Boolean(message.isError));
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  function rememberEditableTarget(event) {
    const target = findEditableFromEvent(event);
    if (!target) {
      return;
    }

    lastEditableTarget = target;
    lastInputSelection = captureInputSelection(target);
    lastEditableRange = captureContentEditableRange(target);
  }

  function forcePasteText(text) {
    const target = getPasteTarget();
    if (!target) {
      return {
        ok: false,
        error: "No editable field is focused."
      };
    }

    if (isTextControl(target)) {
      return pasteIntoTextControl(target, text);
    }

    if (target.isContentEditable) {
      return pasteIntoContentEditable(target, text);
    }

    return {
      ok: false,
      error: "The selected element is not editable."
    };
  }

  function getPasteTarget() {
    if (isEditable(lastEditableTarget) && lastEditableTarget.isConnected) {
      return lastEditableTarget;
    }

    const activeElement = getDeepActiveElement(document);
    if (isEditable(activeElement)) {
      return activeElement;
    }

    return null;
  }

  function findEditableFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (isEditable(item)) {
        return item;
      }
    }

    return isEditable(event.target) ? event.target : null;
  }

  function getDeepActiveElement(root) {
    let activeElement = root.activeElement;

    while (activeElement?.shadowRoot?.activeElement) {
      activeElement = activeElement.shadowRoot.activeElement;
    }

    return activeElement;
  }

  function isEditable(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    if (element instanceof HTMLTextAreaElement) {
      return !element.disabled && !element.readOnly;
    }

    if (element instanceof HTMLInputElement) {
      return isEditableInput(element);
    }

    return element.isContentEditable;
  }

  function isEditableInput(input) {
    if (input.disabled || input.readOnly) {
      return false;
    }

    return !new Set([
      "button",
      "checkbox",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit"
    ]).has(input.type);
  }

  function isTextControl(element) {
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  }

  function pasteIntoTextControl(element, text) {
    element.focus({ preventScroll: true });

    const value = element.value || "";
    const selection = getSelectionForTextControl(element, value);
    const nextValue = value.slice(0, selection.start) + text + value.slice(selection.end);
    const cursor = selection.start + text.length;

    setNativeValue(element, nextValue);

    try {
      element.setSelectionRange(cursor, cursor);
    } catch {
      // Some input types, such as number and date, do not expose text selection.
    }

    dispatchInputEvents(element, text, "insertFromPaste");

    return {
      ok: true,
      value: nextValue
    };
  }

  function getSelectionForTextControl(element, value) {
    if (lastEditableTarget === element && lastInputSelection) {
      return normalizeSelection(lastInputSelection.start, lastInputSelection.end, value.length);
    }

    try {
      return normalizeSelection(element.selectionStart, element.selectionEnd, value.length);
    } catch {
      return {
        start: value.length,
        end: value.length
      };
    }
  }

  function captureInputSelection(element) {
    if (!isTextControl(element)) {
      return null;
    }

    try {
      return {
        start: element.selectionStart,
        end: element.selectionEnd
      };
    } catch {
      return null;
    }
  }

  function normalizeSelection(start, end, fallback) {
    const normalizedStart = Number.isInteger(start) ? start : fallback;
    const normalizedEnd = Number.isInteger(end) ? end : normalizedStart;

    return {
      start: Math.max(0, Math.min(normalizedStart, fallback)),
      end: Math.max(0, Math.min(normalizedEnd, fallback))
    };
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
      return;
    }

    element.value = value;
  }

  function pasteIntoContentEditable(element, text) {
    element.focus({ preventScroll: true });

    const selection = element.ownerDocument.getSelection();
    const range = getRangeForContentEditable(element, selection);
    if (!range) {
      return {
        ok: false,
        error: "Could not place the cursor in the editable content."
      };
    }

    selection.removeAllRanges();
    selection.addRange(range);
    range.deleteContents();

    const textNode = element.ownerDocument.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);

    dispatchInputEvents(element, text, "insertText");

    return {
      ok: true,
      value: element.textContent
    };
  }

  function getRangeForContentEditable(element, selection) {
    if (
      lastEditableTarget === element &&
      lastEditableRange &&
      rangeBelongsToElement(lastEditableRange, element)
    ) {
      return lastEditableRange.cloneRange();
    }

    if (
      selection?.rangeCount > 0 &&
      rangeBelongsToElement(selection.getRangeAt(0), element)
    ) {
      return selection.getRangeAt(0).cloneRange();
    }

    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    return range;
  }

  function captureContentEditableRange(element) {
    if (!element?.isContentEditable) {
      return null;
    }

    const selection = element.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    return rangeBelongsToElement(range, element) ? range.cloneRange() : null;
  }

  function rangeBelongsToElement(range, element) {
    return element.contains(range.commonAncestorContainer);
  }

  function dispatchInputEvents(element, text, inputType) {
    try {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: text,
        inputType
      }));
    } catch {
      element.dispatchEvent(new Event("input", {
        bubbles: true,
        composed: true
      }));
    }

    element.dispatchEvent(new Event("change", {
      bubbles: true,
      composed: true
    }));
  }

  function showToast(text, isError = false) {
    if (!document.documentElement) {
      return;
    }

    const toast = getToastElement();
    toast.textContent = text;
    toast.dataset.state = isError ? "error" : "ok";
    toast.hidden = false;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  function getToastElement() {
    let toast = document.getElementById("__force_paste_toast");
    if (toast) {
      return toast;
    }

    toast = document.createElement("div");
    toast.id = "__force_paste_toast";
    toast.setAttribute("role", "status");
    toast.hidden = true;
    toast.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "max-width:min(320px,calc(100vw - 32px))",
      "padding:10px 12px",
      "border-radius:6px",
      "box-shadow:0 8px 28px rgba(0,0,0,.22)",
      "font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "background:#202124",
      "color:#fff",
      "word-break:break-word"
    ].join(";");

    document.documentElement.appendChild(toast);
    return toast;
  }
})();
