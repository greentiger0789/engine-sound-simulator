import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import {
  createBrowserAudioController,
  type AudioController,
} from "../audio/controller";
import type {
  EngineConfig,
  EngineConfigValidationIssue,
} from "../engine/config";
import { multiCylinderPresets } from "../presets/multicylinder";
import {
  singleCylinderPreset,
  type EnginePreset,
} from "../presets/single-cylinder";

let browserAudioController: AudioController | undefined;

const availablePresets: readonly EnginePreset[] = [
  singleCylinderPreset,
  ...multiCylinderPresets,
];

function phaseValues(config: EngineConfig): string[] {
  return config.cylinders.map((cylinder) => String(cylinder.firingAngleDeg));
}

function phaseIssue(
  issues: readonly EngineConfigValidationIssue[],
  index: number,
): string | undefined {
  return issues.find(
    (issue) => issue.path === `$.cylinders[${index}].firingAngleDeg`,
  )?.message;
}

function getBrowserAudioController(): AudioController {
  // This lives outside React deliberately: StrictMode's development remount
  // must not create another AudioContext or AudioWorkletNode.
  browserAudioController ??= createBrowserAudioController();
  return browserAudioController;
}

export function App() {
  const controller = getBrowserAudioController();
  const subscribe = useCallback(
    (notify: () => void) => controller.subscribe(notify),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [selectedPresetId, setSelectedPresetId] = useState(
    singleCylinderPreset.config.id,
  );
  const [draftConfig, setDraftConfig] = useState<EngineConfig>(
    singleCylinderPreset.config,
  );
  const [phases, setPhases] = useState(() =>
    phaseValues(singleCylinderPreset.config),
  );
  const [validationIssues, setValidationIssues] = useState<
    readonly EngineConfigValidationIssue[]
  >([]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.dispatchEvent(
      new CustomEvent("engine-simulator:app-lifecycle", {
        detail: "mounted",
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("engine-simulator:app-lifecycle", {
          detail: "cleaned-up",
        }),
      );
    };
  }, []);

  const start = useCallback(() => {
    void controller.start();
  }, [controller]);
  const stop = useCallback(() => {
    void controller.stop();
  }, [controller]);

  const selectPreset = useCallback((presetId: string) => {
    const preset = availablePresets.find(
      ({ config }) => config.id === presetId,
    );
    if (!preset) return;
    setSelectedPresetId(presetId);
    setDraftConfig(preset.config);
    setPhases(phaseValues(preset.config));
    setValidationIssues([]);
  }, []);

  const updatePhase = useCallback((index: number, value: string) => {
    setPhases((current) =>
      current.map((phase, currentIndex) =>
        currentIndex === index ? value : phase,
      ),
    );
    setValidationIssues([]);
  }, []);

  const stageConfig = useCallback(() => {
    const input: EngineConfig = {
      ...draftConfig,
      cylinders: draftConfig.cylinders.map((cylinder, index) => ({
        ...cylinder,
        firingAngleDeg:
          phases[index]?.trim() === "" ? Number.NaN : Number(phases[index]),
      })),
    };
    const result = controller.stageConfig(input);
    if (result.ok) {
      setDraftConfig(result.value);
      setPhases(phaseValues(result.value));
      setValidationIssues([]);
    } else if (result.reason === "validation") {
      setValidationIssues(result.issues);
    }
  }, [controller, draftConfig, phases]);

  const isStartingOrRunning =
    snapshot.status === "starting" || snapshot.status === "running";
  const canStop =
    snapshot.status === "starting" ||
    snapshot.status === "running" ||
    snapshot.status === "stopping" ||
    snapshot.status === "suspended";
  const canStageConfig =
    snapshot.status === "idle" ||
    (snapshot.status === "error" && snapshot.error?.code === "config-rejected");
  const firingOrder = useMemo(
    () =>
      draftConfig.cylinders
        .map((cylinder, index) => ({
          index: index + 1,
          phase: phases[index] ?? String(cylinder.firingAngleDeg),
        }))
        .sort((left, right) => Number(left.phase) - Number(right.phase)),
    [draftConfig.cylinders, phases],
  );

  return (
    <main className="app-shell">
      <section aria-labelledby="app-title" className="controller-area">
        <header>
          <p className="eyebrow">Procedural audio</p>
          <h1 id="app-title">Engine sound simulator</h1>
          <p className="intro">
            Start audio when you are ready. The simulator is silent until then.
          </p>
        </header>

        <div className="transport" aria-label="Audio transport">
          <button type="button" onClick={start} disabled={isStartingOrRunning}>
            Start audio
          </button>
          <button type="button" onClick={stop} disabled={!canStop}>
            Stop audio
          </button>
        </div>

        <div className="control-stack">
          <label className="range-control" htmlFor="volume">
            <span>Volume</span>
            <input
              id="volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={snapshot.volume}
              onChange={(event) =>
                controller.setVolume(Number(event.target.value))
              }
            />
            <output htmlFor="volume">
              {Math.round(snapshot.volume * 100)}%
            </output>
          </label>

          <label className="range-control" htmlFor="throttle">
            <span>Throttle</span>
            <input
              id="throttle"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={snapshot.throttle}
              onChange={(event) =>
                controller.setThrottle(Number(event.target.value))
              }
            />
            <output htmlFor="throttle" data-testid="throttle-value">
              {Math.round(snapshot.throttle * 100)}%
            </output>
          </label>

          <label className="mute-control" htmlFor="muted">
            <input
              id="muted"
              type="checkbox"
              checked={snapshot.muted}
              onChange={(event) => controller.setMuted(event.target.checked)}
            />
            Mute audio
          </label>
        </div>

        <section
          className="config-editor"
          aria-labelledby="config-editor-title"
        >
          <header className="config-editor-header">
            <div>
              <p className="eyebrow">Configuration</p>
              <h2 id="config-editor-title">Engine configuration</h2>
            </div>
            <p className="config-state" aria-live="polite">
              Active:{" "}
              <output data-testid="active-config">
                {snapshot.activeConfig.id}
              </output>
              {snapshot.pendingConfig ? (
                <>
                  {" · "}Pending:{" "}
                  <output data-testid="pending-config">
                    {snapshot.pendingConfig.id}
                  </output>
                </>
              ) : (
                <>
                  {" · "}
                  <output data-testid="pending-config">
                    No pending configuration
                  </output>
                </>
              )}
            </p>
          </header>

          <label className="select-control" htmlFor="engine-preset">
            <span>Engine preset</span>
            <select
              id="engine-preset"
              value={selectedPresetId}
              onChange={(event) => selectPreset(event.target.value)}
              disabled={!canStageConfig}
            >
              {availablePresets.map((preset) => (
                <option key={preset.config.id} value={preset.config.id}>
                  {preset.metadata.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset disabled={!canStageConfig}>
            <legend>燃焼位相（720°周期）</legend>
            <div className="phase-inputs">
              {draftConfig.cylinders.map((cylinder, index) => {
                const issue = phaseIssue(validationIssues, index);
                const inputId = `cylinder-phase-${index + 1}`;
                return (
                  <label
                    key={cylinder.id}
                    className="phase-control"
                    htmlFor={inputId}
                  >
                    <span>Cylinder {index + 1} phase (degrees)</span>
                    <input
                      id={inputId}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="719.999"
                      step="any"
                      value={phases[index] ?? ""}
                      onChange={(event) =>
                        updatePhase(index, event.target.value)
                      }
                      aria-invalid={issue ? true : undefined}
                      aria-describedby={issue ? `${inputId}-error` : undefined}
                    />
                    {issue ? (
                      <span className="field-error" id={`${inputId}-error`}>
                        {issue}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="firing-order" aria-label="720 degree firing order">
            <span>720° firing order</span>
            <ol>
              {firingOrder.map(({ index, phase }) => (
                <li
                  key={index}
                  style={
                    { "--phase": `${Number(phase) / 7.2}%` } as CSSProperties
                  }
                >
                  C{index}: {phase}°
                </li>
              ))}
            </ol>
          </div>

          <button
            type="button"
            onClick={stageConfig}
            disabled={!canStageConfig}
          >
            Apply for next start
          </button>
        </section>

        <p className="status" aria-live="polite">
          Status: <output data-testid="audio-status">{snapshot.status}</output>
        </p>
        <dl className="telemetry" aria-label="Engine telemetry">
          <div>
            <dt>RPM</dt>
            <dd data-testid="engine-rpm">
              {Math.round(snapshot.telemetry.rpm)}
            </dd>
          </div>
          <div>
            <dt>Effective throttle</dt>
            <dd data-testid="effective-throttle">
              {Math.round(snapshot.telemetry.effectiveThrottle * 100)}%
            </dd>
          </div>
          <div>
            <dt>Limiter</dt>
            <dd data-testid="limiter-state">
              {snapshot.telemetry.limiterActive ? "active" : "inactive"}
            </dd>
          </div>
        </dl>
        {snapshot.error ? (
          <p className="error" role="alert">
            Audio error ({snapshot.error.code}): {snapshot.error.message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
