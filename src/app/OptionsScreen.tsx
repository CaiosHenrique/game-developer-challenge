import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  DEFAULT_OPTIONS,
  OPTION_LIMITS,
  validateOptions,
  type GameOptions,
} from '../game/options.ts';

type Fields = Record<keyof GameOptions, string>;

const toFields = (options: GameOptions): Fields => ({
  sessionSeconds: String(options.sessionSeconds),
  spawnIntervalSeconds: String(options.spawnIntervalSeconds),
});

/** An empty or malformed field becomes NaN, which validation reports. */
const toNumber = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));

/**
 * Game session time and enemy spawn time. Saved options apply from the next match; they
 * are kept for this session even if the device storage refuses to save them.
 */
export function OptionsScreen({
  options,
  onSave,
  onBack,
}: {
  options: GameOptions;
  /** Applies the options and returns whether they were stored on the device. */
  onSave: (options: GameOptions) => boolean;
  onBack: () => void;
}) {
  const [fields, setFields] = useState<Fields>(() => toFields(options));
  const [status, setStatus] = useState<'idle' | 'saved' | 'notStored'>('idle');
  /** Keyboard focus starts on the first field when the screen opens. */
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => firstField.current?.focus(), []);
  const values = {
    sessionSeconds: toNumber(fields.sessionSeconds),
    spawnIntervalSeconds: toNumber(fields.spawnIntervalSeconds),
  };
  const errors = validateOptions(values);
  const valid = Object.keys(errors).length === 0;

  const update = (name: keyof GameOptions, value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
    setStatus('idle');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setStatus(onSave(values) ? 'saved' : 'notStored');
  };

  const { sessionSeconds: session, spawnIntervalSeconds: spawn } = OPTION_LIMITS;

  return (
    <main className="menu-screen">
      <section className="menu-panel" aria-labelledby="options-title">
        <h1 id="options-title" className="menu-heading">
          Options
        </h1>
        <form className="options-form" onSubmit={submit} noValidate>
          <div className="form-field">
            <label htmlFor="session-seconds">Game session time (seconds)</label>
            <input
              ref={firstField}
              id="session-seconds"
              name="sessionSeconds"
              type="number"
              inputMode="numeric"
              min={session.min}
              max={session.max}
              step={session.step}
              value={fields.sessionSeconds}
              aria-invalid={errors.sessionSeconds ? true : undefined}
              aria-describedby="session-hint session-error"
              onChange={(event) => update('sessionSeconds', event.target.value)}
            />
            <p id="session-hint" className="form-hint">
              Whole seconds, {session.min} to {session.max}.
            </p>
            <p id="session-error" className="form-error" aria-live="polite">
              {errors.sessionSeconds}
            </p>
          </div>
          <div className="form-field">
            <label htmlFor="spawn-seconds">Enemy spawn time (seconds)</label>
            <input
              id="spawn-seconds"
              name="spawnIntervalSeconds"
              type="number"
              inputMode="decimal"
              min={spawn.min}
              max={spawn.max}
              step={spawn.step}
              value={fields.spawnIntervalSeconds}
              aria-invalid={errors.spawnIntervalSeconds ? true : undefined}
              aria-describedby="spawn-hint spawn-error"
              onChange={(event) => update('spawnIntervalSeconds', event.target.value)}
            />
            <p id="spawn-hint" className="form-hint">
              {spawn.min} to {spawn.max} seconds, in steps of {spawn.step}.
            </p>
            <p id="spawn-error" className="form-error" aria-live="polite">
              {errors.spawnIntervalSeconds}
            </p>
          </div>
          <p className="form-status" role="status">
            {status === 'saved' && 'Options saved. They apply from the next battle.'}
            {status === 'notStored' &&
              'Options applied for this session, but they could not be saved on this device.'}
          </p>
          <div className="menu-actions">
            <button type="submit" className="menu-button" disabled={!valid}>
              Save
            </button>
            <button
              type="button"
              className="menu-button menu-button-secondary"
              onClick={() => {
                setFields(toFields(DEFAULT_OPTIONS));
                setStatus('idle');
              }}
            >
              Restore defaults
            </button>
            <button type="button" className="menu-button menu-button-secondary" onClick={onBack}>
              Main Menu
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
