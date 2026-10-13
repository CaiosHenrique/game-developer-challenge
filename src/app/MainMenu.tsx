import { useRef, useState, type KeyboardEvent } from 'react';
import type { GameOptions } from '../game/options.ts';
import type { MockApiStatus } from '../mocks/status.ts';
import type { Player } from '../storage/localStore.ts';
import { HistoryPanel, RankingPanel } from './RecordsPanels.tsx';
import { MENU_ART } from './uiArt.ts';
import { TOUCH_DEVICE_QUERY, useMediaQuery } from './useMediaQuery.ts';

const TABS = [
  { id: 'ranking', label: 'Ranking' },
  { id: 'history', label: 'Match History' },
] as const;

type TabId = (typeof TABS)[number]['id'];

type RecordsProps = { options: GameOptions; player: Player; mockApi: MockApiStatus };

/**
 * Ranking / Match History tabs (WAI-ARIA tabs pattern: arrows, Home and End move focus).
 * Only the selected panel is rendered, so showing a tab again refreshes it; each tab keeps
 * its page while the menu is open.
 */
function MenuTabs({ options, player, mockApi }: RecordsProps) {
  const [selected, setSelected] = useState<TabId>('ranking');
  const [rankingPage, setRankingPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((tab) => tab.id === selected);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const tab = TABS[next]!;
    setSelected(tab.id);
    tabRefs.current[tab.id]?.focus();
  };

  return (
    <div className="menu-tabs">
      <div
        role="tablist"
        aria-label="Battle records"
        className="menu-tablist"
        onKeyDown={onKeyDown}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[tab.id] = element;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected === tab.id ? 0 : -1}
            className="menu-tab"
            onClick={() => setSelected(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={selected !== tab.id}
          className="menu-tabpanel"
        >
          {selected !== tab.id ? null : mockApi.state === 'unavailable' ? (
            <p className="records-message" role="alert">
              Ranking and match history are offline: the mock API could not start in this browser.
              The game still works.
            </p>
          ) : tab.id === 'ranking' ? (
            <RankingPanel
              options={options}
              playerId={player.playerId}
              page={rankingPage}
              onPage={setRankingPage}
            />
          ) : (
            <HistoryPanel
              playerId={player.playerId}
              playerName={player.playerName}
              page={historyPage}
              onPage={setHistoryPage}
            />
          )}
        </div>
      ))}
      {mockApi.state === 'running' && mockApi.persistence === 'memory' && (
        <p className="records-note">
          Storage is unavailable or full in this browser: ranking and history data are kept in
          memory only and reset when the page reloads.
        </p>
      )}
    </div>
  );
}

export function MainMenu({
  options,
  player,
  mockApi,
  onPlay,
  onOptions,
}: RecordsProps & { onPlay: () => void; onOptions: () => void }) {
  const touchDevice = useMediaQuery(TOUCH_DEVICE_QUERY);
  return (
    <main className="menu-screen">
      <section className="menu-panel" aria-labelledby="menu-title">
        <h1 id="menu-title" className="menu-title">
          <img {...MENU_ART.title} alt="Pirate Battle" />
        </h1>
        <p className="menu-tagline">Set sail. Take command.</p>
        <div className="menu-actions">
          <button type="button" className="menu-button" onClick={onPlay}>
            Play
          </button>
          <button type="button" className="menu-button" onClick={onOptions}>
            Options
          </button>
        </div>
        <section className="menu-controls" aria-labelledby="controls-title">
          <h2 id="controls-title">Controls</h2>
          {touchDevice && (
            <p className="menu-touch-hint">
              Touch: hold the buttons on the left to sail and turn, and the buttons on the right to
              fire. Play in landscape.
            </p>
          )}
          <dl>
            <div>
              <dt>Sail forward</dt>
              <dd>
                <kbd>W</kbd> / <kbd>↑</kbd>
              </dd>
            </div>
            <div>
              <dt>Turn</dt>
              <dd>
                <kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd>
              </dd>
            </div>
            <div>
              <dt>Front gun</dt>
              <dd>
                <kbd>Space</kbd>
              </dd>
            </div>
            <div>
              <dt>Broadsides</dt>
              <dd>
                <kbd>Q</kbd> left · <kbd>E</kbd> right
              </dd>
            </div>
            <div>
              <dt>Pause</dt>
              <dd>
                <kbd>P</kbd> / <kbd>Esc</kbd>
              </dd>
            </div>
          </dl>
        </section>
        <MenuTabs options={options} player={player} mockApi={mockApi} />
      </section>
    </main>
  );
}
