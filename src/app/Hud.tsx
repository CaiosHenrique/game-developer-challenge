import type { HudState } from '../game/hudStore.ts';
import { formatClock } from './format.ts';
import { HEALTH_BAR, HUD_ART } from './uiArt.ts';
import { useTouchTap } from './useTouchTap.ts';

/**
 * Match HUD: health, score and time left. It re-renders only when one of these values
 * changes (the game publishes through a store that skips unchanged states).
 */
export function Hud({ hud, onPause }: { hud: HudState; onPause: () => void }) {
  const pauseTap = useTouchTap(onPause);
  const ratio = Math.min(1, Math.max(0, hud.hp / hud.maxHp));
  const fill =
    ratio > 2 / 3
      ? HUD_ART.healthFillGreen
      : ratio > 1 / 3
        ? HUD_ART.healthFillAmber
        : HUD_ART.healthFillRed;
  // Crop the fill art from the right so only the remaining health shows.
  const visibleEnd = HEALTH_BAR.fill.x + HEALTH_BAR.fill.w * ratio;
  const cropRight = ((HEALTH_BAR.width - visibleEnd) / HEALTH_BAR.width) * 100;

  return (
    <section className="hud" aria-label="Match status">
      <dl className="hud-stats">
        <div className="hud-health">
          <dt className="visually-hidden">Health</dt>
          <dd>
            <img className="hud-heart" {...HUD_ART.iconHeart} alt="" />
            <span className="hud-bar" aria-hidden="true">
              <img {...HUD_ART.healthFrame} alt="" />
              <img {...fill} alt="" style={{ clipPath: `inset(0 ${cropRight}% 0 0)` }} />
            </span>
            <span className="hud-bar-label">
              {hud.hp} / {hud.maxHp}
            </span>
          </dd>
        </div>
        <div className="hud-counter hud-score">
          <dt className="visually-hidden">Score</dt>
          <dd>
            <img className="hud-counter-panel" {...HUD_ART.counterPanel} alt="" />
            <img className="hud-counter-icon" {...HUD_ART.iconScore} alt="" />
            <span className="hud-counter-value">{hud.score}</span>
          </dd>
        </div>
        <div className="hud-counter hud-time">
          <dt className="visually-hidden">Time left</dt>
          <dd>
            <img className="hud-counter-panel" {...HUD_ART.counterPanel} alt="" />
            <img className="hud-counter-icon" {...HUD_ART.iconTime} alt="" />
            <time className="hud-counter-value" dateTime={`PT${hud.remainingSeconds}S`}>
              {formatClock(hud.remainingSeconds)}
            </time>
          </dd>
        </div>
      </dl>
      {hud.phase === 'running' && !hud.pauseReason && (
        <button type="button" className="hud-pause" aria-label="Pause" {...pauseTap}>
          <img {...HUD_ART.buttonRound} alt="" />
          <img className="hud-pause-icon" {...HUD_ART.iconPause} alt="" />
        </button>
      )}
    </section>
  );
}
