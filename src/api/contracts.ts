import { z } from 'zod';
import { OPTION_LIMITS } from '../game/options.ts';

/**
 * Contracts of the ranking and match-history API. The same schemas validate requests and
 * responses in the mock server (MSW) and responses in the client, so both sides agree.
 */

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

const { sessionSeconds: sessionLimits, spawnIntervalSeconds: spawnLimits } = OPTION_LIMITS;

/** The match options a record was played with. Ranking only compares equal configurations. */
export const matchConfigSchema = z.object({
  sessionSeconds: z.number().int().min(sessionLimits.min).max(sessionLimits.max),
  spawnIntervalSeconds: z
    .number()
    .min(spawnLimits.min)
    .max(spawnLimits.max)
    .refine((value) => Number.isInteger(value / spawnLimits.step), 'Not on a 0.5 s step'),
});
export type MatchConfig = z.infer<typeof matchConfigSchema>;

/** Stable identifier of a configuration, e.g. "120s-5s" or "90s-2.5s". */
export function configKeyOf(config: MatchConfig): string {
  return `${config.sessionSeconds}s-${config.spawnIntervalSeconds}s`;
}

export const configKeySchema = z.string().regex(/^\d+s-\d+(\.5)?s$/, 'Invalid configuration key');

export const endReasonSchema = z.enum(['time', 'death']);
export type EndReason = z.infer<typeof endReasonSchema>;

const recordFields = {
  matchId: z.string().min(1).max(64),
  /** Local, simulated identity (there is no authentication): generated once per device. */
  playerId: z.string().min(1).max(64),
  playerName: z.string().min(1).max(40),
  /** ISO 8601 timestamp (UTC) of the end of the match. */
  finishedAt: z.iso.datetime(),
  score: z.number().int().nonnegative(),
  /** Active play time, in seconds (pauses excluded). */
  durationSeconds: z.number().nonnegative(),
  endReason: endReasonSchema,
  config: matchConfigSchema,
  configKey: configKeySchema,
};

const configKeyMatches = (record: { config: MatchConfig; configKey: string }) =>
  record.configKey === configKeyOf(record.config);
const configKeyMessage = { message: 'configKey does not match config', path: ['configKey'] };

/** One completed match: a single history record and a single ranking entry. */
export const matchRecordSchema = z.object(recordFields).refine(configKeyMatches, configKeyMessage);
export type MatchRecord = z.infer<typeof matchRecordSchema>;

/** A ranking line: the record and its position among matches with the same configuration. */
export const rankingEntrySchema = z
  .object({ ...recordFields, rank: z.number().int().positive() })
  .refine(configKeyMatches, configKeyMessage);
export type RankingEntry = z.infer<typeof rankingEntrySchema>;

/**
 * One page of a list. Pages are numbered from 1. The metadata must agree with itself:
 * - a page holds at most `pageSize` items;
 * - `totalPages` is `ceil(totalItems / pageSize)`, so an empty list has 0 pages;
 * - a page holds exactly the items that fall on it: `pageSize` on a full page, the rest on
 *   the last one, and none on a page past the end (a valid, empty answer).
 */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z
    .object({
      items: z.array(item),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
      totalItems: z.number().int().nonnegative(),
      totalPages: z.number().int().nonnegative(),
    })
    .superRefine(({ items, page, pageSize, totalItems, totalPages }, context) => {
      if (items.length > pageSize) {
        context.addIssue({ code: 'custom', path: ['items'], message: 'More items than pageSize' });
      }
      if (totalPages !== Math.ceil(totalItems / pageSize)) {
        context.addIssue({
          code: 'custom',
          path: ['totalPages'],
          message: 'totalPages does not match totalItems and pageSize',
        });
      }
      const onThisPage = Math.min(pageSize, Math.max(0, totalItems - (page - 1) * pageSize));
      if (items.length !== onThisPage) {
        context.addIssue({
          code: 'custom',
          path: ['items'],
          message: `Expected ${onThisPage} items on page ${page}`,
        });
      }
    });
}
export type Page<Item> = {
  items: Item[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export const rankingPageSchema = pageSchema(rankingEntrySchema);
export const matchPageSchema = pageSchema(matchRecordSchema);

/** Query string of a paginated request (the server applies the defaults). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export const rankingQuerySchema = pageQuerySchema.extend({ configKey: configKeySchema });

/** Body of every error response. */
export const apiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
