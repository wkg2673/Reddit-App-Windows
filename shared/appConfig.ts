/**
 * Cross-context configuration shared by the Electron main process, the preload
 * bridge and the React shell.
 *
 * This module must stay free of any Node.js or DOM imports so it can be bundled
 * into all three contexts.
 */

export const APP_ID = 'com.redditdesktop.app';

export const APP_NAME = 'Reddit Desktop';

/** The only site this app is allowed to render. */
export const HOME_URL = 'https://www.reddit.com/';

/**
 * Persistent session partition. `persist:` guarantees that cookies, localStorage
 * and caches are written to disk so the user stays logged in between launches.
 */
export const SESSION_PARTITION = 'persist:reddit';

/** Custom scheme used to serve the production shell (never `file://`). */
export const APP_SCHEME = 'app';

export const APP_ORIGIN = `${APP_SCHEME}://bundle`;

/**
 * When true the window keeps the native Windows caption buttons (snap layouts,
 * native minimise/maximise/close) and the React toolbar reserves space for
 * them. Set to false to render our own caption buttons instead.
 */
export const USE_NATIVE_WINDOW_CONTROLS = true;

/** Height of the drag region / toolbar, also used as the caption overlay height. */
export const TOOLBAR_HEIGHT = 44;

/** Approximate width the Windows caption overlay reserves on the right. */
export const CAPTION_OVERLAY_WIDTH = 138;

export const DEFAULT_WINDOW_WIDTH = 1280;

export const DEFAULT_WINDOW_HEIGHT = 860;

export const MIN_WINDOW_WIDTH = 520;

export const MIN_WINDOW_HEIGHT = 420;

/** Extra room kept between a restored window and the edges of its display. */
export const WINDOW_VISIBLE_MARGIN = 48;

export const IPC = {
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowState: 'window:state',
  windowStateChanged: 'window:state-changed',
  captionColors: 'window:caption-colors',
  appInfo: 'app:info',
  openExternal: 'app:open-external',
  themeChanged: 'app:theme-changed',
} as const;

export interface AppInfo {
  version: string;
  electronVersion: string;
  chromeVersion: string;
  platform: string;
  isDev: boolean;
}

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

/** Windows-only privacy: no background throttling, no crash dialogs in the shell. */
export const APP_SWITCHES: Record<string, string> = {
  'disable-features': 'CalculateNativeWinOcclusion',
};
