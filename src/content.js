(() => {
  const loadMarker = Symbol.for("forcePaste.contentLoaded");
  if (globalThis[loadMarker]) {
    return;
  }
  globalThis[loadMarker] = true;

  const editableInputTypes = new Set([
    "email",
    "password",
    "search",
    "tel",
    "text",
    "url"
  ]);

  let lastEditableTarget = null;
  let lastInputSelection = null;
  let lastEditableRange = null;

  document.addEventListener("contextmenu", rememberEditableTarget, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "FORCE_PASTE_TEXT") {
      const result = forcePasteText(message.text || "");
      logPasteResult(result);
      sendResponse(result);
      return false;
    }

    return false;
  });

  function rememberEditableTarget(event) {
    const target = findEditableFromEvent(event);
    if (!target) {
      clearRememberedEditableTarget();
      return;
    }

    lastEditableTarget = target;
    lastInputSelection = captureInputSelection(target);
    lastEditableRange = captureContentEditableRange(target);
  }

  function clearRememberedEditableTarget() {
    lastEditableTarget = null;
    lastInputSelection = null;
    lastEditableRange = null;
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

    const activeElement = normalizeEditableTarget(getDeepActiveElement(document));
    if (activeElement) {
      return activeElement;
    }

    return null;
  }

  function findEditableFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      const target = normalizeEditableTarget(item);
      if (target) {
        return target;
      }
    }

    return normalizeEditableTarget(event.target);
  }

  function normalizeEditableTarget(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    if (element instanceof HTMLTextAreaElement) {
      return isEditableTextArea(element) ? element : null;
    }

    if (element instanceof HTMLInputElement) {
      return isEditableInput(element) ? element : null;
    }

    return getContentEditableHost(element);
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
      return isEditableTextArea(element);
    }

    if (element instanceof HTMLInputElement) {
      return isEditableInput(element);
    }

    return Boolean(getContentEditableHost(element));
  }

  function isEditableTextArea(textarea) {
    return !textarea.disabled && !textarea.readOnly;
  }

  function isEditableInput(input) {
    if (input.disabled || input.readOnly) {
      return false;
    }

    return editableInputTypes.has(input.type);
  }

  function getContentEditableHost(element) {
    if (!element.isContentEditable) {
      return null;
    }

    let host = element;
    while (host.parentElement?.isContentEditable) {
      host = host.parentElement;
    }

    return host;
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
      ok: true
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
      ok: true
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

  function logPasteResult(result) {
    if (result.ok) {
      console.debug("Force Paste completed.");
      return;
    }

    console.warn("Force Paste failed:", result.error || "Unknown error.");
  }

})();
