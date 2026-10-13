import type { InputState } from './sim/simulation.ts';

/** A game command a touch button can hold. */
export type TouchAction = keyof InputState;

function emptyInput(): InputState {
  return {
    forward: false,
    turnLeft: false,
    turnRight: false,
    fireFront: false,
    fireLeft: false,
    fireRight: false,
  };
}

/**
 * Touch commands held by on-screen buttons. Each pointer (finger) holds one action, so
 * several fingers can sail, turn and fire at the same time. Releasing is idempotent: a
 * pointer released twice (e.g. `pointerup` then `lostpointercapture`) changes nothing.
 */
export class TouchInput {
  readonly state: InputState = emptyInput();
  private readonly pointers = new Map<number, TouchAction>();

  press(pointerId: number, action: TouchAction): void {
    this.pointers.set(pointerId, action);
    this.update();
  }

  release(pointerId: number): void {
    if (this.pointers.delete(pointerId)) this.update();
  }

  /** Releases every pointer (pause, resume, end of match, controls unmounted, focus lost). */
  reset(): void {
    this.pointers.clear();
    this.update();
  }

  private update(): void {
    Object.assign(this.state, emptyInput());
    for (const action of this.pointers.values()) this.state[action] = true;
  }
}

/**
 * Commands from several sources (keyboard, touch). An action is held while any source holds
 * it, so releasing it on one source never cancels it on another.
 */
export function combineInputs(target: InputState, ...sources: InputState[]): InputState {
  for (const action of Object.keys(target) as TouchAction[]) {
    target[action] = sources.some((source) => source[action]);
  }
  return target;
}
