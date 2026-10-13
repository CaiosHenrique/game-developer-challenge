import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { refreshRecordQueries } from '../api/queries.ts';
import { DEFAULT_SCENARIO, isScenarioId, SCENARIOS, scenarioLabel } from '../mocks/scenarios.ts';
import type { MockApiStatus } from '../mocks/status.ts';

/**
 * Developer panel of the mock API: chooses how it answers (network scenario) and restores
 * its initial data. Collapsed by default; a scenario other than Normal shows in its title.
 */
export function NetworkScenarios({
  status,
}: {
  status: Extract<MockApiStatus, { state: 'running' }>;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const selectId = useId();
  const descriptionId = useId();
  const current = SCENARIOS.find((scenario) => scenario.id === status.scenario)!;

  // The tabs on screen are asked again under the new scenario (or data).
  const refreshTabs = () => refreshRecordQueries(queryClient);

  return (
    <details className="mock-panel">
      <summary>
        Network scenarios (mock API)
        {status.scenario !== DEFAULT_SCENARIO && (
          <>
            : <strong>{current.label}</strong>
          </>
        )}
      </summary>
      <div className="mock-panel-body">
        <label htmlFor={selectId}>Scenario</label>
        <select
          id={selectId}
          value={status.scenario}
          aria-describedby={descriptionId}
          onChange={(event) => {
            const next = event.target.value;
            if (!isScenarioId(next)) return;
            status.controls.setScenario(next);
            refreshTabs();
            setMessage(`Scenario set to ${scenarioLabel(next)}.`);
          }}
        >
          {SCENARIOS.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.label}
            </option>
          ))}
        </select>
        <p id={descriptionId} className="mock-panel-description">
          {current.description}
        </p>
        <button
          type="button"
          className="records-button"
          onClick={() => {
            status.controls.reset();
            refreshTabs();
            setMessage('Mock data restored: initial matches and the Normal scenario.');
          }}
        >
          Reset mock data
        </button>
        <p className="mock-panel-status" role="status">
          {message}
        </p>
      </div>
    </details>
  );
}
