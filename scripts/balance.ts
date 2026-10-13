/**
 * Balance report: plays many seeded matches headlessly (the simulation is pure, no browser)
 * with two player policies and prints survival, death rate and score.
 *
 *   npm run balance            # 50 seeds per policy
 *   npm run balance -- 200     # more seeds
 *
 * Policies:
 * - idle: the player never touches the controls (worst case).
 * - bot:  a simple heuristic player that sails at the nearest enemy, fires the front gun
 *         when it is lined up and a broadside when it is abeam. It is not a strong player:
 *         it only shows whether an engaged player can survive and score.
 */
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../src/game/config.ts';
import { headingTowards, wrapAngle } from '../src/game/sim/ai.ts';
import { Simulation, type InputState } from '../src/game/sim/simulation.ts';

type Policy = (sim: Simulation) => InputState;

const IDLE: InputState = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
};

const idle: Policy = () => IDLE;

const bot: Policy = (sim) => {
  const { player, enemies } = sim;
  const { front, side } = sim.config.weapons;
  let target = enemies[0];
  let nearest = Infinity;
  for (const enemy of enemies) {
    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (distance < nearest) {
      nearest = distance;
      target = enemy;
    }
  }
  if (!target) return { ...IDLE, forward: true, turnRight: sim.tick % 240 < 60 };

  const offset = wrapAngle(headingTowards(player, target) - player.heading);
  const abeam = Math.abs(Math.abs(offset) - Math.PI / 2) < 0.35;
  return {
    forward: true,
    turnLeft: offset < -0.05,
    turnRight: offset > 0.05,
    fireFront: Math.abs(offset) < 0.15 && nearest < front.range,
    fireLeft: abeam && offset < 0 && nearest < side.range,
    fireRight: abeam && offset > 0 && nearest < side.range,
  };
};

type MatchStats = { seconds: number; died: boolean; score: number; rammed: number };

function play(config: GameConfig, seed: number, policy: Policy): MatchStats {
  const sim = new Simulation(config, { seed });
  while (sim.phase === 'running') sim.step(policy(sim));
  return {
    seconds: sim.endTick! / config.simulation.stepsPerSecond,
    died: sim.endReason === 'death',
    score: sim.score,
    rammed: sim.enemiesDestroyed.ramming,
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const seeds = Number(process.argv[2] ?? 50);
const config = DEFAULT_GAME_CONFIG;
console.log(
  `Balance report: ${seeds} seeds per policy, match ${config.match.durationSeconds} s, ` +
    `spawn every ${config.spawn.intervalSeconds} s (first at ${config.spawn.firstDelaySeconds} s)`,
);
console.log('policy | died  | survival median / min (s) | score mean / max | rams taken mean');
for (const [name, policy] of [
  ['idle', idle],
  ['bot', bot],
] as const) {
  const runs = Array.from({ length: seeds }, (_, index) => play(config, index + 1, policy));
  const survival = runs.map((run) => run.seconds);
  const scores = runs.map((run) => run.score);
  const deaths = runs.filter((run) => run.died).length;
  console.log(
    `${name.padEnd(6)} | ${String(Math.round((deaths / seeds) * 100)).padStart(3)}%  | ` +
      `${median(survival).toFixed(1).padStart(6)} / ${Math.min(...survival)
        .toFixed(1)
        .padStart(5)}` +
      `            | ${mean(scores).toFixed(1).padStart(5)} / ${String(Math.max(...scores)).padStart(3)}` +
      `       | ${mean(runs.map((run) => run.rammed)).toFixed(1)}`,
  );
}
