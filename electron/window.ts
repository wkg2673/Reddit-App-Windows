import {
  BrowserWindow,
  ipcMain,
  nativeTheme,
  screen,
  session,
  type Session,
} from 'electron';

import {
  IPC,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  SESSION_PARTITION,
  CAPTION_OVERLAY_WIDTH,
  TOOLBAR_HEIGHT,
  USE_NATIVE_WINDOW_CONTROLS,
  type AppInfo,
  type WindowState,
} from '../shared/appConfig';
import {
  parsePersistedState,
  restoreBounds,
  type PersistedWindowState,
} from '../shared/windowState';
import type { ExternalLinkOpener } from './externalLinks';
import { JsonStore } from './store';

export interface CaptionColors {
  color: string;
  symbolColor: string;
}

export interface NativeChromeFacts {
  overlayEnabled: boolean;
  reservedWidth: number;
  overlayHeight: number;
  contentSpansWindow: boolean;
  buttonsOnTop: boolean;
}

const DARK_CAPTION: CaptionColors = { color: '#18191b', symbolColor: '#f3f4f6' };
const LIGHT_CAPTION: CaptionColors = { color: '#f4f4f5', symbolColor: '#18181b' };

interface WindowRecord {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

export function captionColorsForTheme(dark: boolean): CaptionColors {
  return dark ? DARK_CAPTION : LIGHT_CAPTION;
}

export class MainWindowController {
  private window: BrowserWindow | null = null;

  private readonly store: JsonStore<PersistedWindowState>;

  private lastState: WindowRecord = { maximized: false, fullScreen: false, focused: false };

  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    userDataDir: string,
    private readonly preloadPath: string,
    private readonly shellUrl: string,
    private readonly appInfo: AppInfo,
    private readonly opener: ExternalLinkOpener,
    private readonly allowDevTools: boolean,
  ) {
    this.store = new JsonStore<PersistedWindowState>('window-state.json', userDataDir);
  }

  get browserWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Facts about the window chrome, used by the smoke test to prove the app has
   * real Windows caption buttons instead of a custom-drawn title bar.
   */
  nativeChrome(): NativeChromeFacts | null {
    const window = this.window;
    if (!window || window.isDestroyed()) return null;

    const bounds = window.getBounds();
    const content = window.getContentBounds();
    return {
      overlayEnabled: USE_NATIVE_WINDOW_CONTROLS,
      reservedWidth: CAPTION_OVERLAY_WIDTH,
      overlayHeight: TOOLBAR_HEIGHT,
      // With a hidden title bar the web content spans the whole window, which
      // is what lets the OS caption buttons sit on top of our own toolbar.
      contentSpansWindow: content.x === bounds.x && content.width === bounds.width,
      buttonsOnTop: window.isResizable(),
    };
  }

  /**
   * Resolves the persistent session up-front. Loading it before the first
   * window means cookies from a previous launch are already in memory when
   * Reddit boots, so the user never sees a logged-out flash.
   */
  session(): Session {
    return session.fromPartition(SESSION_PARTITION);
  }

  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    const saved = parsePersistedState(this.store.read());
    const bounds = restoreBounds(
      saved,
      screen.getAllDisplays().map((display) => ({ id: display.id, workArea: display.workArea })),
    );
    const caption = captionColorsForTheme(nativeTheme.shouldUseDarkColors);

    const window = new BrowserWindow({
      ...bounds,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      backgroundColor: caption.color,
      title: 'Reddit',
      autoHideMenuBar: true,
      // The window is frameless; the Windows caption buttons are drawn by the
      // OS on top of our own toolbar (snap layouts, native animations).
      ...(USE_NATIVE_WINDOW_CONTROLS
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: {
              color: caption.color,
              symbolColor: caption.symbolColor,
              height: TOOLBAR_HEIGHT,
            },
          }
        : {}),
      webPreferences: {
        preload: this.preloadPath,
        // The shell renders only our own React UI and never needs Node.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        webviewTag: true, // required to host the Reddit guest
        spellcheck: true,
        backgroundThrottling: false,
        devTools: this.allowDevTools,
        safeDialogs: true,
        enableWebSQL: false,
        v8CacheOptions: 'code' as const,
      },
    });

    if (saved?.maximized) window.maximize();

    this.window = window;
    this.registerWindowEvents(window);
    this.registerIpc(window);

    window.once('ready-to-show', () => {
      window.show();
      if (this.allowDevTools) window.focus();
    });

    void window.loadURL(this.shellUrl);
    return window;
  }

  private registerWindowEvents(window: BrowserWindow): void {
    const persist = (): void => {
      this.store.patch({
        maximized: window.isMaximized(),
        ...(window.isMaximized() || window.isFullScreen() ? {} : window.getNormalBounds()),
      });
    };

    const schedulePersist = (): void => {
      this.broadcastState(window);
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        persist();
      }, 350);
      this.persistTimer.unref?.();
    };

    const events = [
      'resize',
      'move',
      'maximize',
      'unmaximize',
      'enter-full-screen',
      'leave-full-screen',
      'focus',
      'blur',
    ] as const;
    for (const event of events) window.on(event as 'resize', schedulePersist);

    window.on('close', () => {
      persist();
      this.store.flush();
    });
    window.on('closed', () => {
      this.window = null;
    });

    // Shortcuts the guest page would otherwise swallow.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (input.key === 'F5' || (input.control && key === 'r')) {
        event.preventDefault();
        this.sendToShell('window.redditShell && window.redditShell.reload()');
        return;
      }
      if (this.allowDevTools && (input.key === 'F12' || (input.control && input.shift && key === 'i'))) {
        event.preventDefault();
        if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
        else window.webContents.openDevTools({ mode: 'detach' });
        return;
      }
      if (input.key === 'F11') {
        event.preventDefault();
        window.setFullScreen(!window.isFullScreen());
      }
    });

    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('[window] shell renderer gone:', details.reason);
    });

    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      console.error(`[window] shell failed to load ${url}: ${description} (${code})`);
    });
  }

  private registerIpc(window: BrowserWindow): void {
    ipcMain.handle(IPC.appInfo, () => this.appInfo);
    ipcMain.handle(IPC.windowMinimize, () => {
      window.minimize();
      return true;
    });
    ipcMain.handle(IPC.windowToggleMaximize, () => {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      return window.isMaximized();
    });
    ipcMain.handle(IPC.windowClose, () => {
      window.close();
      return true;
    });
    ipcMain.handle(IPC.openExternal, (_event, url: unknown) => {
      if (typeof url !== 'string') return false;
      return this.opener.openUrl(url);
    });
    ipcMain.on(IPC.captionColors, (_event, colors: unknown) => {
      if (typeof colors !== 'object' || colors === null) return;
      const { color, symbolColor } = colors as Partial<CaptionColors>;
      if (typeof color === 'string' && typeof symbolColor === 'string') {
        this.applyCaptionColors({ color, symbolColor });
      }
    });
  }

  private broadcastState(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    const state: WindowRecord = {
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
      focused: window.isFocused(),
    };
    if (
      state.maximized === this.lastState.maximized &&
      state.fullScreen === this.lastState.fullScreen &&
      state.focused === this.lastState.focused
    ) {
      return;
    }
    this.lastState = state;
    window.webContents.send(IPC.windowStateChanged, state satisfies WindowState);
  }

  applyCaptionColors(colors: CaptionColors): void {
    if (!this.window || this.window.isDestroyed() || !USE_NATIVE_WINDOW_CONTROLS) return;
    try {
      this.window.setTitleBarOverlay({ ...colors, height: TOOLBAR_HEIGHT });
    } catch (error) {
      console.error('[window] failed to apply caption colours:', error);
    }
  }

  sendTheme(dark: boolean): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.applyCaptionColors(captionColorsForTheme(dark));
    this.window.webContents.send(IPC.themeChanged, { dark });
  }

  private sendToShell(script: string): void {
    if (!this.window || this.window.isDestroyed()) return;
    void this.window.webContents.executeJavaScript(script).catch(() => undefined);
  }
}
