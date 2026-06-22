# Privacy Policy for Force Paste

Last updated: June 22, 2026

## Overview

Force Paste is a Chrome extension that adds a `Force Paste` action to editable-field context menus. When the user chooses that action, the extension reads the user's clipboard text and inserts it into the right-clicked input, textarea, or `contenteditable` field, bypassing page-level paste blockers.

This extension is designed to work locally in the browser. It does not operate a backend service and does not send page contents, editable-field contents, or clipboard contents to the developer.

## What the extension accesses

The extension can run on `http://`, `https://`, and, when the user enables Chrome's **Allow access to file URLs** toggle, `file://` pages.

On those pages, the extension accesses only what is needed to provide the requested Force Paste action:

- the editable element that the user right-clicked
- the selection or cursor position inside that editable element
- the user's clipboard text when the user chooses `Force Paste`
- the page DOM needed to insert text and dispatch normal `input` and `change` events

## What data is collected

The extension does not collect personal data for the developer.

The extension does not:

- create user accounts
- transmit browsing data to external servers
- transmit clipboard contents to external servers
- store pasted text on a remote service
- use analytics, advertising, or tracking pixels
- sell or share personal information

## How data is used

When a user chooses `Force Paste`, the extension reads text from the user's clipboard and inserts it into the editable field that the user selected through the context menu.

The clipboard text may contain personal or sensitive information if the user copied such information. The extension processes that text locally only to complete the user's requested paste action.

After the text is inserted into a web page, that page may be able to read, process, store, or transmit the inserted text according to that page's own behavior and privacy policy. Force Paste does not control the destination page after insertion.

## Where data is processed

Processing happens locally in the browser on the user's device.

The extension does not intentionally transmit page contents, editable-field contents, selections, or clipboard payloads to the developer or to third parties.

## Data storage

The extension does not maintain a remote database and does not intentionally store personal data outside the user's browser session.

The extension temporarily remembers the right-clicked editable field and its cursor or selection position so it can insert clipboard text into the correct target. This state is kept in the page context and is not sent to the developer.

Clipboard contents remain in the user's clipboard until the user replaces or clears them, consistent with normal browser and operating system clipboard behavior.

## Third-party services

The extension runs on pages selected by the user, including websites and local files where Chrome permits extension access.

Other than operating on the current page selected by the user, the extension does not intentionally connect to third-party services for analytics, advertising, profiling, or data resale.

## Security

The extension is intended to use the minimum behavior needed to perform a user-initiated Force Paste action: identify the right-clicked editable field, read clipboard text after the user chooses the menu action, and insert the text locally.

No security system can guarantee absolute protection, but the extension is designed to minimize data handling by keeping processing local and avoiding unnecessary collection or transmission.

## Children's privacy

The extension is not directed to children and is not intended to collect personal information from children.

## Changes to this policy

This privacy policy may be updated to reflect changes in the extension's functionality or Chrome Web Store requirements. The updated version will be posted at the same public policy URL used for the extension listing.

## Contact

For privacy questions about this extension, contact the publisher using the contact information provided in the Chrome Web Store listing or the project repository.
