import { useSyncExternalStore } from 'react';

/** Whether a CSS media query currently matches, updated when it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Devices whose main pointer is a finger. */
export const TOUCH_DEVICE_QUERY = '(pointer: coarse)';
/** A touch device held in portrait: matches are played in landscape. */
export const PORTRAIT_TOUCH_QUERY = '(orientation: portrait) and (pointer: coarse)';
