/**
 * Pure geometry helpers for restoring the window between launches.
 *
 * No Electron imports: the main process supplies the display list, this module
 * decides which rectangle is safe to use.
 */

import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_VISIBLE_MARGIN,
} from './appConfig';

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  workArea: Rectangle;
}

export interface PersistedWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  );
}

/** Loosely validates data read from disk before it is trusted. */
export function parsePersistedState(raw: unknown): PersistedWindowState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (!isRectangle(value)) return null;
  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
    ...(typeof value.maximized === 'boolean' ? { maximized: value.maximized } : {}),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function defaultBounds(): WindowBounds {
  return {
    x: 0,
    y: 0,
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
  };
}

/**
 * Picks the bounds to restore.
 *
 * A saved position is only honoured when a comfortable amount of the title bar
 * remains on a connected display, otherwise the window would be invisible or
 * stranded on a monitor that is no longer there.
 */
export function restoreBounds(
  saved: PersistedWindowState | null,
  displays: readonly DisplayLike[],
): WindowBounds {
  if (displays.length === 0) return { ...defaultBounds(), ...(saved ?? {}) };

  const primary = displays[0] as DisplayLike;
  if (!saved) {
    return {
      x: Math.round(primary.workArea.x + (primary.workArea.width - DEFAULT_WINDOW_WIDTH) / 2),
      y: Math.round(primary.workArea.y + (primary.workArea.height - DEFAULT_WINDOW_HEIGHT) / 2),
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    };
  }

  const width = clamp(
    Math.round(saved.width),
    MIN_WINDOW_WIDTH,
    Math.max(MIN_WINDOW_WIDTH, primary.workArea.width),
  );
  const height = clamp(
    Math.round(saved.height),
    MIN_WINDOW_HEIGHT,
    Math.max(MIN_WINDOW_HEIGHT, primary.workArea.height),
  );

  const matches = displays.find((display) => {
    const area = display.workArea;
    const overlapX = Math.min(saved.x + width, area.x + area.width) - Math.max(saved.x, area.x);
    const overlapY = Math.min(saved.y + height, area.y + area.height) - Math.max(saved.y, area.y);
    return overlapX >= WINDOW_VISIBLE_MARGIN && overlapY >= WINDOW_VISIBLE_MARGIN;
  });

  if (!matches) {
    // The display the window was on is gone: centre it on the primary display.
    return {
      x: Math.round(primary.workArea.x + (primary.workArea.width - width) / 2),
      y: Math.round(primary.workArea.y + (primary.workArea.height - height) / 2),
      width,
      height,
    };
  }

  return {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width,
    height,
  };
}
