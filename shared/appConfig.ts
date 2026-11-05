/**
 * Cross-context configuration shared by Electron main process, preload bridge
 * and the React shell.
 * This module must stay free of any Node.js or DOM imports so it can be bundled
 * into all three contexts.
 */

export const APP_ID = 'com.redditdesktop.app';

export const APP_NAME = 'Reddit Desktop';

export const HOME_URL = 'https://www.reddit.com/';

export const SESSION_PARTITION = 'persist:reddit';

export const APP_SCHEME = 'app';

export const APP_ORIGIN = `${APP_SCHEME}://bundle`;

export const USE_NATIVE_WINDOW_CONTROLS = true;

export const TOOLBAR_HEIGHT = 44;

export const CAPTION_OVERLAY_WIDTH = 138;

export const DEFAULT_WINDOW_WIDTH = 1280;

export const DEFAULT_WINDOW_HEIGHT = 860;

export const MIN_WINDOW_WIDTH = 520;

export const MIN_WINDOW_HEIGHT = 420;

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

export const APP_SWITCHES: Record<string, string> = {
  'disable-features': 'CalculateNativeWinOcclusion',
};
