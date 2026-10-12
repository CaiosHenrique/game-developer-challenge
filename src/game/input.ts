import type { InputState } from './sim/simulation.ts';

type Action = keyof InputState;

/** Keyboard bindings by `KeyboardEvent.code`, so they follow key position, not layout. */
const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyA: 'turnLeft',
  ArrowLeft: 'turnLeft',
  KeyD: 'turnRight',
  ArrowRight: 'turnRight',
  Space: 'fireFront',
  KeyQ: 'fireLeft',
  KeyE: 'fireRight',
};

/**
 * Tracks held game keys. It only listens while attached, i.e. while a match is on screen,
 * and releases every key when the window loses focus.
 */
export class KeyboardInput {
  readonly state: InputState = {
    forward: false,
    turnLeft: false,
    turnRight: false,
    fireFront: false,
    fireLeft: false,
    fireRight: false,
  };
  private readonly pressed = new Set<string>();
  private target: Window | null = null;

  attach(target: Window): void {
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.reset);
  }

  detach(): void {
    this.target?.removeEventListener('keydown', this.onKeyDown);
    this.target?.removeEventListener('keyup', this.onKeyUp);
    this.target?.removeEventListener('blur', this.reset);
    this.target = null;
    this.reset();
  }

  readonly reset = (): void => {
    this.pressed.clear();
    this.updateState();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || !(event.code in KEY_BINDINGS)) return;
    event.preventDefault();
    this.pressed.add(event.code);
    this.updateState();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!this.pressed.delete(event.code)) return;
    event.preventDefault();
    this.updateState();
  };

  private updateState(): void {
    for (const action of Object.keys(this.state) as Action[]) this.state[action] = false;
    for (const code of this.pressed) {
      const action = KEY_BINDINGS[code];
      if (action) this.state[action] = true;
    }
  }
}
