import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const contentScriptPath = join(root, "src", "content.js");
const contentScript = await readFile(contentScriptPath, "utf8");

async function main() {
  const chromePath = await findChrome();
  if (!chromePath) {
    console.log("Browser integration skipped: Chrome executable was not found.");
    return;
  }

  const server = await startStaticServer(root);
  const testUrl = `http://127.0.0.1:${server.address().port}/tests/paste-block-test.html`;
  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: process.env.HEADFUL ? false : "new",
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps"
      ]
    });

    const page = await browser.newPage();
    await installRuntimeMock(page);
    await page.goto(testUrl, { waitUntil: "domcontentloaded" });
    await installRuntimeMockInFrame(page.mainFrame());
    await injectContentScript(page.mainFrame());
    await page.waitForFunction(() => {
      return Boolean(window.__forcePasteMessageListener && window.forcePasteTest);
    });
    const iframe = await setupIframeTest(page);

    await assertHostilePageBlocksPaste(page);
    await assertDirectPasteLikeAssignmentIsRejected(page);
    await assertRightClickTargetIsPreserved(page);
    await assertTextSelectionReplacement(page);
    await assertForcePasteWorksAcrossFieldTypes(page);
    await assertIframeForcePasteWorks(iframe);

    console.log("Browser integration checks passed");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function installRuntimeMock(page) {
  await page.evaluateOnNewDocument(installForcePasteRuntimeMock);
}

async function installRuntimeMockInFrame(frame) {
  await frame.evaluate(installForcePasteRuntimeMock);
}

async function injectContentScript(frame) {
  await frame.evaluate((script) => {
    const scriptElement = document.createElement("script");
    scriptElement.textContent = script;
    document.documentElement.appendChild(scriptElement);
    scriptElement.remove();
  }, contentScript);
}

async function setupIframeTest(page) {
  const iframe = await waitForTestIframe(page);
  await installRuntimeMockInFrame(iframe);
  await injectContentScript(iframe);
  await iframe.waitForFunction(() => {
    return Boolean(window.__forcePasteMessageListener && window.forcePasteFrameTest);
  });
  return iframe;
}

async function waitForTestIframe(page) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const frame of page.frames()) {
      if (!frame.parentFrame()) {
        continue;
      }

      const isFixture = await frame.evaluate(() => {
        return Boolean(window.forcePasteFrameTest);
      }).catch(() => false);

      if (isFixture) {
        return frame;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for the iframe test fixture.");
}

function installForcePasteRuntimeMock() {
  if (window.__forcePasteRuntimeMockInstalled) {
    return;
  }

  window.__forcePasteRuntimeMockInstalled = true;
  window.chrome = {
    ...(window.chrome || {}),
    runtime: {
      ...((window.chrome && window.chrome.runtime) || {}),
      onMessage: {
        addListener(listener) {
          window.__forcePasteMessageListener = listener;
        }
      }
    }
  };
}

async function assertIframeForcePasteWorks(frame) {
  const blocked = await frame.evaluate(() => {
    return {
      paste: window.forcePasteFrameTest.assertPasteBlocked(),
      beforeinput: window.forcePasteFrameTest.assertBeforeInputPasteBlocked()
    };
  });

  assert(blocked.paste, "Expected paste to be blocked inside the iframe.");
  assert(blocked.beforeinput, "Expected beforeinput paste to be blocked inside the iframe.");

  const text = `iframe paste ${Date.now()}`;
  const result = await frame.evaluate(async (text) => {
    window.forcePasteFrameTest.clearField();
    window.forcePasteFrameTest.rightClickField();
    const response = await window.forcePasteFrameTest.sendForcePaste(text);

    return {
      response,
      value: window.forcePasteFrameTest.getValue()
    };
  }, text);

  assert(result.response.ok, result.response.error || "Force Paste failed inside the iframe.");
  assert(result.value === text, `Expected iframe input to contain ${JSON.stringify(text)}, got ${JSON.stringify(result.value)}.`);
}

async function assertHostilePageBlocksPaste(page) {
  const results = await page.evaluate(() => {
    return window.forcePasteTest.blockedIds.map((id) => ({
      id,
      paste: window.forcePasteTest.assertPasteBlocked(id),
      beforeinput: window.forcePasteTest.assertBeforeInputPasteBlocked(id)
    }));
  });

  for (const result of results) {
    assert(result.paste, `Expected paste to be blocked on #${result.id}`);
    assert(result.beforeinput, `Expected beforeinput paste to be blocked on #${result.id}`);
  }
}

async function assertDirectPasteLikeAssignmentIsRejected(page) {
  const rejected = await page.evaluate(() => {
    return window.forcePasteTest.assertControlledRejectsDirectPasteLikeChange();
  });

  assert(rejected, "The controlled-style input did not reject a direct paste-like value assignment.");
}

async function assertRightClickTargetIsPreserved(page) {
  const text = `right-click target ${Date.now()}`;
  const result = await forcePaste(page, "blocked-input", text, {
    focusOtherFieldBeforePaste: true
  });

  assert(result.response.ok, result.response.error || "Force Paste failed.");
  assert(result.value === text, "Force Paste did not use the right-clicked target.");
  assert(result.allowedValue === "", "Force Paste wrote into the active field instead of the right-clicked field.");
}

async function assertTextSelectionReplacement(page) {
  const result = await forcePaste(page, "blocked-input", "XX", {
    initialValue: "abcd",
    selectionStart: 1,
    selectionEnd: 3
  });

  assert(result.response.ok, result.response.error || "Force Paste failed.");
  assert(result.value === "aXXd", `Expected selected text to be replaced, got ${JSON.stringify(result.value)}.`);
}

async function assertForcePasteWorksAcrossFieldTypes(page) {
  const cases = [
    ["blocked-password", "password-value-123"],
    ["blocked-email", "person@example.com"],
    ["blocked-textarea", "line one\nline two"],
    ["blocked-editable", "contenteditable text"],
    ["blocked-controlled", "controlled text"]
  ];

  for (const [id, text] of cases) {
    const result = await forcePaste(page, id, text);
    assert(result.response.ok, result.response.error || `Force Paste failed for #${id}`);
    assert(result.value === text, `Expected #${id} to contain ${JSON.stringify(text)}, got ${JSON.stringify(result.value)}.`);

    if (id === "blocked-controlled") {
      assert(result.controlledValue === text, "The controlled-style input did not sync app state from input events.");
    }
  }
}

async function forcePaste(page, id, text, options = {}) {
  return page.evaluate(async ({ id, text, options }) => {
    window.forcePasteTest.clearFields();

    if (Object.prototype.hasOwnProperty.call(options, "initialValue")) {
      window.forcePasteTest.setFieldValue(id, options.initialValue);
    }

    window.forcePasteTest.rightClickField(id, options.selectionStart, options.selectionEnd);

    if (options.focusOtherFieldBeforePaste) {
      window.forcePasteTest.focusField("allowed-textarea");
    }

    const response = await window.forcePasteTest.sendForcePaste(text);

    return {
      response,
      value: window.forcePasteTest.getValue(id),
      allowedValue: window.forcePasteTest.getValue("allowed-textarea"),
      controlledValue: window.forcePasteTest.controlledValue
    };
  }, { id, text, options });
}

async function startStaticServer(baseDir) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = url.pathname === "/" ? "/tests/paste-block-test.html" : url.pathname;
      const file = resolve(baseDir, `.${decodeURIComponent(pathname)}`);

      if (!file.startsWith(`${baseDir}/`) && file !== baseDir) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": contentTypeFor(file)
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function contentTypeFor(file) {
  switch (extname(file)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }

  return null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

await main();
