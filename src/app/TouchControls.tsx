import { useEffect, useState, type PointerEvent } from 'react';
import type { TouchAction } from '../game/touchInput.ts';
import { TOUCH_ART, type Art } from './uiArt.ts';

type ButtonSpec = { action: TouchAction; label: string; icon: Art };

const MOVEMENT: ButtonSpec[] = [
  { action: 'turnLeft', label: 'Turn left', icon: TOUCH_ART.iconTurnLeft },
  { action: 'forward', label: 'Sail forward', icon: TOUCH_ART.iconForward },
  { action: 'turnRight', label: 'Turn right', icon: TOUCH_ART.iconTurnRight },
];

const WEAPONS: ButtonSpec[] = [
  { action: 'fireLeft', label: 'Fire left broadside', icon: TOUCH_ART.iconFireLeft },
  { action: 'fireFront', label: 'Fire front gun', icon: TOUCH_ART.iconFireFront },
  { action: 'fireRight', label: 'Fire right broadside', icon: TOUCH_ART.iconFireRight },
];

/**
 * On-screen buttons for touch devices. Each finger holds the button it pressed until it is
 * lifted, cancelled or slides off the button; several buttons can be held at once. Keyboard
 * users have the keys, so these buttons stay out of the Tab order.
 */
export function TouchControls({
  onPress,
  onRelease,
  onReleaseAll,
}: {
  onPress: (pointerId: number, action: TouchAction) => void;
  onRelease: (pointerId: number) => void;
  onReleaseAll: () => void;
}) {
  /** Pointers holding each button, for the pressed look. */
  const [held, setHeld] = useState<ReadonlyMap<number, TouchAction>>(new Map());

  // Removing the controls (pause, end of match, leaving) releases whatever they held.
  useEffect(() => onReleaseAll, [onReleaseAll]);

  const release = (pointerId: number) => {
    onRelease(pointerId);
    setHeld((current) => {
      if (!current.has(pointerId)) return current;
      const next = new Map(current);
      next.delete(pointerId);
      return next;
    });
  };

  const handlers = (action: TouchAction) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onPress(event.pointerId, action);
      setHeld((current) => new Map(current).set(event.pointerId, action));
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      // Sliding off the button lets go of it (capture would otherwise keep it held).
      const box = event.currentTarget.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) release(event.pointerId);
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => release(event.pointerId),
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => release(event.pointerId),
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => release(event.pointerId),
  });

  const pressed = new Set(held.values());
  const renderPad = (buttons: ButtonSpec[], side: 'left' | 'right') => (
    <div className={`touch-pad touch-pad-${side}`}>
      {buttons.map(({ action, label, icon }) => (
        <button
          key={action}
          type="button"
          tabIndex={-1}
          aria-label={label}
          aria-pressed={pressed.has(action)}
          className={`touch-button touch-${action}`}
          data-pressed={pressed.has(action) || undefined}
          {...handlers(action)}
        >
          <img className="touch-button-icon" {...icon} alt="" draggable={false} />
        </button>
      ))}
    </div>
  );

  return (
    <div
      className="touch-controls"
      data-testid="touch-controls"
      onContextMenu={(event) => event.preventDefault()}
    >
      {renderPad(MOVEMENT, 'left')}
      {renderPad(WEAPONS, 'right')}
    </div>
  );
}
