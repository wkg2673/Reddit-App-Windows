import { contextBridge, ipcRenderer } from 'electron';

import { IPC, type AppInfo, type WindowState } from '../shared/appConfig';

/**
 * The only bridge between the (untrusted-by-design) renderer and the main
 * process. Nothing here exposes `ipcRenderer`, `require`, `process` or any
 * Electron object to page scripts.
 */
const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  },
  window: {
    minimize: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowClose),
    onStateChange: (listener: (state: WindowState) => void): (() => void) => {
      const handler = (_event: unknown, state: WindowState): void => listener(state);
      ipcRenderer.on(IPC.windowStateChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.windowStateChanged, handler);
      };
    },
  },
  theme: {
    onChange: (listener: (theme: { dark: boolean }) => void): (() => void) => {
      const handler = (_event: unknown, theme: { dark: boolean }): void => listener(theme);
      ipcRenderer.on(IPC.themeChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.themeChanged, handler);
      };
    },
    setCaptionColors: (colors: { color: string; symbolColor: string }): void => {
      ipcRenderer.send(IPC.captionColors, colors);
    },
  },
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.openExternal, url),
} as const;

export type RedditDesktopBridge = typeof api;

contextBridge.exposeInMainWorld('redditDesktop', api);
