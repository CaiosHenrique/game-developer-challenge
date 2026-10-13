/** The HUD values announcements are derived from. */
export type AnnouncedState = {
  hp: number;
  maxHp: number;
  score: number;
  remainingSeconds: number;
  phase: 'running' | 'ended';
  endReason: 'time' | 'death' | null;
  paused: boolean;
};

/** Remaining-time thresholds that are announced once. */
export const TIME_WARNINGS = [30, 10] as const;
/** Health fraction at or below which "Health low" is announced (once per match). */
export const LOW_HEALTH_FRACTION = 0.25;

/**
 * Message for a screen-reader live region, or null when nothing worth announcing happened.
 * Only discrete events are announced (never the running clock), at most one per update,
 * by priority: match end, pause/resume, low health, time warning, score.
 */
export function announcementFor(
  previous: AnnouncedState,
  next: AnnouncedState,
  lowHealthAnnounced: boolean,
): string | null {
  if (next.phase === 'ended' && previous.phase !== 'ended') {
    return next.endReason === 'death'
      ? `Your ship sank. Final score ${next.score}.`
      : `Battle complete. Final score ${next.score}.`;
  }
  if (next.paused !== previous.paused) return next.paused ? 'Game paused.' : 'Game resumed.';
  if (!lowHealthAnnounced && next.hp > 0 && next.hp <= next.maxHp * LOW_HEALTH_FRACTION) {
    return 'Health low.';
  }
  for (const seconds of TIME_WARNINGS) {
    if (previous.remainingSeconds > seconds && next.remainingSeconds <= seconds) {
      return `${seconds} seconds left.`;
    }
  }
  if (next.score > previous.score) return `Score ${next.score}.`;
  return null;
}
