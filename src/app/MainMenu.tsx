import { useRef, useState, type KeyboardEvent } from 'react';
import { MENU_ART } from './uiArt.ts';
import { TOUCH_DEVICE_QUERY, useMediaQuery } from './useMediaQuery.ts';

const TABS = [
  { id: 'ranking', label: 'Ranking', placeholder: 'The online ranking will be shown here.' },
  { id: 'history', label: 'Match History', placeholder: 'Your past battles will be listed here.' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Ranking / Match History tabs (WAI-ARIA tabs pattern: arrows, Home and End move focus). */
function MenuTabs() {
  const [selected, setSelected] = useState<TabId>('ranking');
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
          <p>{tab.placeholder}</p>
        </div>
      ))}
    </div>
  );
}

export function MainMenu({ onPlay, onOptions }: { onPlay: () => void; onOptions: () => void }) {
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
        <MenuTabs />
      </section>
    </main>
  );
}
