import type { Player, StoredResult } from '../storage/localStore.ts';
import { configKeyOf, matchRecordSchema, type MatchRecord } from './contracts.ts';

/**
 * The online record of a completed match, built from its stored result and the player who
 * played it. Every field comes from the result as recorded when the match ended (match id,
 * end time, active time, end reason and options): nothing is generated again. Returns null
 * when the result cannot make a valid record (e.g. an old or damaged stored result).
 */
export function matchRecordFrom(result: StoredResult, player: Player): MatchRecord | null {
  const config = {
    sessionSeconds: result.options.sessionSeconds,
    spawnIntervalSeconds: result.options.spawnIntervalSeconds,
  };
  const record = matchRecordSchema.safeParse({
    matchId: result.matchId,
    playerId: player.playerId,
    playerName: player.playerName,
    finishedAt: result.finishedAt,
    score: result.score,
    durationSeconds: result.timePlayedSeconds,
    endReason: result.reason,
    config,
    configKey: configKeyOf(config),
  });
  return record.success ? record.data : null;
}
