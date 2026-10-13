/** mm:ss for a number of seconds (rounded down). */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/** A match date in the player's time zone, e.g. "Oct 12, 2026, 2:05 PM". */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** The options a match was played with, e.g. "120 s · enemies every 5 s". */
export function formatSetup(config: { sessionSeconds: number; spawnIntervalSeconds: number }) {
  return `${config.sessionSeconds} s · enemies every ${config.spawnIntervalSeconds} s`;
}
