# Reddit Desktop for Windows

A Reddit client that looks and behaves like a normal Windows app: no address bar, no
tabs, native window buttons, and logins that survive restarts. It is built with
Electron, so it ships its own Chromium and never touches Edge or WebView2.

![toolbar](docs/toolbar.png)

## What you get

- **Reddit in a real app window.** The page fills the window below a compact toolbar;
  the window keeps the standard Windows caption buttons, snap layouts and animations.
- **Stays logged in.** Cookies live in a persistent session partition in your user
  profile, so you sign in once.
- **Links behave sensibly.** Anything inside Reddit stays in the app; anything else
  opens in your default browser.
- **Remembers your window.** Position, size and maximized state come back next launch.
- **Installs cleanly.** An NSIS installer with a desktop shortcut, a Start Menu entry,
  and an entry in *Apps & features* that uninstalls properly.

## Requirements

Windows 10 or 11, x64. Nothing else: no separate browser runtime is needed.

## Install

Run `Reddit-1.0.0-Setup.exe` from the `release` folder after building (see
[Building](#building)).

Uninstall from *Settings → Apps → Installed apps → Reddit*. Your login and settings
are kept on purpose, so reinstalling does not sign you out.

## Using it

| Action | How |
| --- | --- |
| Back / forward | Toolbar buttons, or `Alt` + `←` / `→` |
| Reload | `F5`, or the toolbar button |
| Stop loading | The toolbar button turns into a stop button while a page loads |
| Home | `Alt` + `Home`, or the toolbar button |
| Open current page in your browser | The ↗ button on the right of the toolbar |
| DevTools | `Ctrl` + `Shift` + `I` (available in unpackaged builds) |

## Building

```bash
npm install
npm run dev      # live-reloading renderer + auto-rebuilt main process
```

Production artefacts:

```bash
npm run pack     # -> release/win-unpacked/Reddit.exe
npm run dist     # -> release/Reddit-1.0.0-Setup.exe  (+ blockmap)
```

The icon is generated from source, so it can be regenerated after a tweak:

```bash
npm run icon
```

## Checks

```bash
npm run typecheck
npm run lint
npm test         # unit tests for URL policy, window state, UA, repo wiring
npm run smoke    # boots the real app against reddit.com, 32 checks
```

`npm run smoke` launches the app twice with a throwaway profile: once to seed state,
once to prove it survived a full restart. It verifies that Reddit actually renders
posts, that navigation and history work, that popups and cross-site links open
externally, that the guest has no Node or bridge access, that the toolbar reserves
space for the native caption buttons, and that cookies and window bounds persist.

Point it at a packaged build to test the real binary:

```bash
npm run pack
npm run smoke -- --exe "release/win-unpacked/Reddit.exe"
```

## How it is put together

```
electron/main.ts        app lifecycle, app:// protocol, session wiring, smoke entry
electron/window.ts      BrowserWindow, native caption overlay, persisted geometry
electron/security.ts    permission allowlist, guest session filter, navigation guards
electron/preload.ts     the small contextBridge surface exposed to the shell
src/renderer/           the React shell: toolbar, webview host, styles
shared/                 pure logic shared by main and renderer (navigation, state, UA)
```

A few decisions worth knowing about:

- **The shell is a custom `app://` page, not a file path.** In a packaged app a
  `file://` document cannot load ES modules under a strict CSP; a registered
  privileged scheme can.
- **Reddit runs in a `<webview>`, not an iframe.** Reddit sends
  `X-Frame-Options`/frame-busting headers, so an iframe cannot display it. The
  webview gets a locked-down guest session with Node integration off, no preload
  bridge, and enforced navigation rules.
- **The user agent is rewritten** to a plain Chrome UA on the Reddit session, because
  Reddit serves a degraded experience to anything identifying itself as Electron.
- **`storage-access` is granted to third-party frames.** Reddit's sign-in is gated by
  a reCAPTCHA frame from Google; denying it makes logins fail intermittently. It is
  a storage-partitioning API, not a device capability.

## Licence

This project is not affiliated with or endorsed by Reddit, Inc.

<p align="left">
  <sub>Made with OpenCode</sub>
</p>
