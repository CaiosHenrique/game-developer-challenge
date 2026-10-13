import { useRef, type PointerEvent } from 'react';

/** A click this soon after a recognised tap belongs to that tap. */
const CLICK_AFTER_TAP_MS = 800;

/**
 * Button handlers that also work for a finger tap made while another finger is held on the
 * screen (e.g. on a touch control). Browsers do not send `click` for such a tap, so a touch
 * pointer that goes down and up on the button activates it; the click that a lone tap still
 * sends afterwards is ignored so the action runs once. Mouse, pen and keyboard use `click`.
 */
export function useTouchTap(onTap: () => void) {
  const pointerId = useRef<number | null>(null);
  const lastTap = useRef(-Infinity);
  return {
    onClick(event: { timeStamp: number }) {
      if (event.timeStamp - lastTap.current < CLICK_AFTER_TAP_MS) return;
      onTap();
    },
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.pointerType === 'touch') pointerId.current = event.pointerId;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if (event.pointerId !== pointerId.current) return;
      pointerId.current = null;
      const box = event.currentTarget.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) return;
      lastTap.current = event.timeStamp;
      onTap();
    },
    onPointerCancel() {
      pointerId.current = null;
    },
  };
}
