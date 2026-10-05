import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
} from '../shared/appConfig';
import {
  parsePersistedState,
  restoreBounds,
  type DisplayLike,
} from '../shared/windowState';

const primary: DisplayLike = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const secondary: DisplayLike = { id: 2, workArea: { x: 1920, y: -200, width: 2560, height: 1400 } };

describe('parsePersistedState', () => {
  it('accepts a well formed rectangle', () => {
    expect(parsePersistedState({ x: 10, y: 20, width: 800, height: 600, maximized: true })).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      maximized: true,
    });
  });

  it('rejects garbage instead of throwing', () => {
    for (const value of [null, undefined, 42, 'nope', {}, { x: 1, y: 2 }, { x: NaN, y: 0, width: 1, height: 1 }]) {
      expect(parsePersistedState(value), String(value)).toBeNull();
    }
  });
});

describe('restoreBounds', () => {
  it('centres a default-sized window on the primary display', () => {
    const bounds = restoreBounds(null, [primary]);
    expect(bounds).toEqual({
      x: Math.round((1920 - DEFAULT_WINDOW_WIDTH) / 2),
      y: Math.round((1040 - DEFAULT_WINDOW_HEIGHT) / 2),
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    });
  });

  it('restores a window that is still fully on screen', () => {
    const bounds = restoreBounds({ x: 120, y: 80, width: 1000, height: 700 }, [primary]);
    expect(bounds).toEqual({ x: 120, y: 80, width: 1000, height: 700 });
  });

  it('keeps a window on a secondary display', () => {
    const saved = { x: 2200, y: 100, width: 1200, height: 800 };
    expect(restoreBounds(saved, [primary, secondary])).toEqual(saved);
  });

  it('re-centres when the saved display is gone', () => {
    const bounds = restoreBounds({ x: 4000, y: 2000, width: 1000, height: 700 }, [primary]);
    expect(bounds).toEqual({
      x: Math.round((1920 - 1000) / 2),
      y: Math.round((1040 - 700) / 2),
      width: 1000,
      height: 700,
    });
  });

  it('re-centres when only a sliver would be reachable', () => {
    // 12px of the title bar visible: not usable for dragging.
    const bounds = restoreBounds({ x: 1908, y: 500, width: 1000, height: 700 }, [primary]);
    expect(bounds.x).toBe(Math.round((1920 - 1000) / 2));
  });

  it('clamps to the minimum size', () => {
    const bounds = restoreBounds({ x: 10, y: 10, width: 10, height: 10 }, [primary]);
    expect(bounds.width).toBe(MIN_WINDOW_WIDTH);
    expect(bounds.height).toBe(MIN_WINDOW_HEIGHT);
  });

  it('clamps to the work area of a small display', () => {
    const small: DisplayLike = { id: 3, workArea: { x: 0, y: 0, width: 640, height: 480 } };
    const bounds = restoreBounds({ x: 0, y: 0, width: 4000, height: 3000 }, [small]);
    expect(bounds.width).toBe(640);
    expect(bounds.height).toBe(480);
    expect(bounds.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH);
  });

  it('falls back to the default size when no display is known', () => {
    expect(restoreBounds(null, [])).toEqual({
      x: 0,
      y: 0,
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    });
  });
});
