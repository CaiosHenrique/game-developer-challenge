import { configKeyOf } from '../api/contracts.ts';
import { useHistoryPage, useRankingPage } from '../api/queries.ts';
import type { GameOptions } from '../game/options.ts';
import { formatClock, formatDateTime, formatSetup } from './format.ts';
import { RecordsView } from './RecordsView.tsx';

/** Ranking of the matches played with the current options (only equal setups compare). */
export function RankingPanel({
  options,
  playerId,
  page,
  onPage,
}: {
  options: GameOptions;
  playerId: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const query = useRankingPage(configKeyOf(options), page);
  return (
    <>
      <p className="records-setup">
        Matches of <strong>{formatSetup(options)}</strong> (your current options)
      </p>
      <RecordsView
        query={query}
        page={page}
        onPage={onPage}
        what="ranking"
        empty="No battles recorded with these options yet."
      >
        {(entries, shownPage) => (
          <table className="records-table">
            <caption className="visually-hidden">Ranking, page {shownPage}</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Captain</th>
                <th scope="col">Score</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const own = entry.playerId === playerId;
                return (
                  <tr key={entry.matchId} className={own ? 'records-own' : undefined}>
                    <td>{entry.rank}</td>
                    <th scope="row">
                      {entry.playerName}
                      {own && <span className="records-you"> (you)</span>}
                    </th>
                    <td>{entry.score}</td>
                    <td>{formatClock(entry.durationSeconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </RecordsView>
    </>
  );
}

/** Matches of this device's player, most recent first. */
export function HistoryPanel({
  playerId,
  playerName,
  page,
  onPage,
}: {
  playerId: string;
  playerName: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const query = useHistoryPage(playerId, page);
  return (
    <>
      <p className="records-setup">
        Battles of <strong>{playerName}</strong> (this device)
      </p>
      <RecordsView
        query={query}
        page={page}
        onPage={onPage}
        what="match history"
        empty="No battles recorded yet."
      >
        {(matches, shownPage) => (
          <table className="records-table">
            <caption className="visually-hidden">Match history, page {shownPage}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Score</th>
                <th scope="col">Time</th>
                <th scope="col">Ended by</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.matchId}>
                  <th scope="row">
                    <time dateTime={match.finishedAt}>{formatDateTime(match.finishedAt)}</time>
                    <span className="records-detail">{formatSetup(match.config)}</span>
                  </th>
                  <td>{match.score}</td>
                  <td>{formatClock(match.durationSeconds)}</td>
                  <td>{match.endReason === 'time' ? 'Time up' : 'Ship sunk'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RecordsView>
    </>
  );
}
