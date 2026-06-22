const MENU_ID = "force-paste";
const OFFSCREEN_DOCUMENT_PATH = "src/offscreen.html";

let creatingOffscreenDocument;
let resettingContextMenu;

chrome.runtime.onInstalled.addListener(() => {
  resetContextMenu().catch((error) => console.error("Force Paste menu setup failed", error));
});

chrome.runtime.onStartup.addListener(() => {
  resetContextMenu().catch((error) => console.error("Force Paste menu setup failed", error));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }

  handleForcePaste(info, tab).catch((error) => {
    console.error("Force Paste failed", error);
  });
});

async function resetContextMenu() {
  if (resettingContextMenu) {
    return resettingContextMenu;
  }

  resettingContextMenu = (async () => {
    await removeAllContextMenus();
    await createContextMenu(getContextMenuProperties());
  })();

  try {
    await resettingContextMenu;
  } finally {
    resettingContextMenu = undefined;
  }
}

function removeAllContextMenus() {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function createContextMenu(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function getContextMenuProperties() {
  return {
    id: MENU_ID,
    title: "Force Paste",
    contexts: ["editable"]
  };
}

async function handleForcePaste(info, tab) {
  const clipboardText = await readClipboardText();
  return pasteTextIntoTab(tab.id, info.frameId, clipboardText);
}

async function pasteTextIntoTab(tabId, frameId, text) {
  const message = {
    type: "FORCE_PASTE_TEXT",
    text
  };

  try {
    return await sendMessageToFrame(tabId, frameId, message);
  } catch (firstError) {
    await injectContentScript(tabId, frameId);
    try {
      return await sendMessageToFrame(tabId, frameId, message);
    } catch (secondError) {
      secondError.message = `${secondError.message}; initial delivery failed with: ${firstError.message}`;
      throw secondError;
    }
  }
}

async function sendMessageToFrame(tabId, frameId, message) {
  const options = typeof frameId === "number" ? { frameId } : undefined;
  return chrome.tabs.sendMessage(tabId, message, options);
}

async function injectContentScript(tabId, frameId) {
  const target = typeof frameId === "number"
    ? { tabId, frameIds: [frameId] }
    : { tabId };

  await chrome.scripting.executeScript({
    target,
    files: ["src/content.js"]
  });
}

async function readClipboardText() {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "READ_CLIPBOARD_TEXT"
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to read clipboard text.");
  }

  return response.text || "";
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if ("getContexts" in chrome.runtime) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
      return;
    }
  } else {
    const clients = await self.clients.matchAll();
    if (clients.some((client) => client.url === offscreenUrl)) {
      return;
    }
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["CLIPBOARD"],
      justification: "Read the clipboard when the user chooses Force Paste."
    });
  }

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}
