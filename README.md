# Force Paste

Chrome MV3 extension that adds a **Force Paste** action to editable-field context menus. The action reads the current clipboard text and inserts it directly into the right-clicked input, textarea, or `contenteditable` element, bypassing page-level `paste` event blockers.

## Load the extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this repository folder.

For `file://` pages, open the extension details from `chrome://extensions` and enable **Allow access to file URLs**. Chrome requires this user-level toggle even when the manifest uses `<all_urls>`.

## Manual integration test

Run the test page from localhost:

```sh
npm run serve:test
```

Open [http://127.0.0.1:8000/tests/paste-block-test.html](http://127.0.0.1:8000/tests/paste-block-test.html), click **Copy sample text**, right-click inside a blocked field, and choose **Force Paste**.

You can also open `tests/paste-block-test.html` directly as a `file://` page after enabling file URL access for the extension.

## Automated checks

```sh
npm test
```

The automated browser integration test launches Chrome, loads the hostile test page, injects the production `src/content.js` with a mocked extension runtime, and verifies that Force Paste insertion works across blocked `input`, password, email, textarea, contenteditable, and controlled-style fields.

To run against a specific Chrome-compatible binary:

```sh
CHROME_BIN=/path/to/chrome npm test
```

## Privacy

See [chrome_privacy_policy.md](chrome_privacy_policy.md).

## License

[MIT](LICENSE)
