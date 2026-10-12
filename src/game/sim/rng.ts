/**
 * Seeded pseudo-random generator (mulberry32). It is the only source of randomness in the
 * simulation: the same seed always produces the same sequence.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Current internal state, so tests can compare generators. */
  get currentState(): number {
    return this.state;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [0, count). */
  int(count: number): number {
    return Math.floor(this.next() * count);
  }
}
