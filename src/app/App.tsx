import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  createBrowserAudioController,
  MAX_LOAD_TORQUE_NM,
  type AudioController,
} from "../audio/controller";
import type {
  EngineConfig,
  EngineConfigValidationIssue,
} from "../engine/config";
import { multiCylinderPresets } from "../presets/multicylinder";
import { vEightPreset, vSixPreset } from "../presets/automotive";
import {
  singleCylinderPreset,
  twoStrokeSingleCylinderPreset,
  type EnginePreset,
} from "../presets/single-cylinder";
import { EngineVisualizations } from "../components/EngineVisualizations";

let browserAudioController: AudioController | undefined;

const availablePresets: readonly EnginePreset[] = [
  singleCylinderPreset,
  twoStrokeSingleCylinderPreset,
  ...multiCylinderPresets,
  vSixPreset,
  vEightPreset,
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

function strokeCycleLabel(cycleDegrees: number): string {
  if (cycleDegrees === 360) return "2-stroke · 360° cycle";
  if (cycleDegrees === 720) return "4-stroke · 720° cycle";
  return `${cycleDegrees}° cycle`;
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
  const [vehicleMassKg, setVehicleMassKg] = useState(() =>
    String(snapshot.drivetrainConfig.vehicleMassKg),
  );
  const [gearRatios, setGearRatios] = useState(() =>
    snapshot.drivetrainConfig.gearRatios.slice(1).map(String),
  );
  const [drivetrainIssues, setDrivetrainIssues] = useState<
    readonly { readonly path: string; readonly message: string }[]
  >([]);
  const holdingPointerThrottle = useRef(false);
  const holdingPointerId = useRef<number | null>(null);
  const holdingKeyboardThrottle = useRef(false);
  const firstInvalidPhaseRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const handleVisibilityChange = () => {
      void controller.handleVisibilityChange(document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [controller]);

  const start = useCallback(() => {
    void controller.start();
  }, [controller]);
  const stop = useCallback(() => {
    void controller.stop();
  }, [controller]);
  const syncHoldThrottle = useCallback(() => {
    controller.setThrottle(
      holdingPointerThrottle.current || holdingKeyboardThrottle.current ? 1 : 0,
    );
  }, [controller]);
  const holdPointerThrottle = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      holdingPointerId.current = event.pointerId;
      holdingPointerThrottle.current = true;
      syncHoldThrottle();
    },
    [syncHoldThrottle],
  );
  const releasePointerThrottle = useCallback(
    (pointerId?: number) => {
      if (
        !holdingPointerThrottle.current ||
        (pointerId !== undefined && holdingPointerId.current !== pointerId)
      )
        return;
      holdingPointerThrottle.current = false;
      holdingPointerId.current = null;
      syncHoldThrottle();
    },
    [syncHoldThrottle],
  );
  const releaseKeyboardThrottle = useCallback(() => {
    if (!holdingKeyboardThrottle.current) return;
    holdingKeyboardThrottle.current = false;
    syncHoldThrottle();
  }, [syncHoldThrottle]);
  const releaseAllHoldThrottle = useCallback(() => {
    if (!holdingPointerThrottle.current && !holdingKeyboardThrottle.current)
      return;
    holdingPointerThrottle.current = false;
    holdingPointerId.current = null;
    holdingKeyboardThrottle.current = false;
    syncHoldThrottle();
  }, [syncHoldThrottle]);

  useEffect(() => {
    const isEditingText = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      );
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditingText(event.target)) return;
      event.preventDefault();
      holdingKeyboardThrottle.current = true;
      syncHoldThrottle();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !holdingKeyboardThrottle.current) return;
      event.preventDefault();
      releaseKeyboardThrottle();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    const pointerUp = (event: PointerEvent) =>
      releasePointerThrottle(event.pointerId);
    const blur = () => releaseAllHoldThrottle();
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("blur", blur);
      releaseAllHoldThrottle();
    };
  }, [
    releaseAllHoldThrottle,
    releaseKeyboardThrottle,
    releasePointerThrottle,
    syncHoldThrottle,
  ]);

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
      // Return keyboard users to the first field that needs attention.
      requestAnimationFrame(() => firstInvalidPhaseRef.current?.focus());
    }
  }, [controller, draftConfig, phases]);

  const stageDrivetrainConfig = useCallback(() => {
    const result = controller.stageDrivetrainConfig({
      ...snapshot.drivetrainConfig,
      vehicleMassKg:
        vehicleMassKg.trim() === "" ? Number.NaN : Number(vehicleMassKg),
      gearRatios: [
        0,
        ...gearRatios.map((ratio) =>
          ratio.trim() === "" ? Number.NaN : Number(ratio),
        ),
      ],
    });
    if (result.ok) {
      setVehicleMassKg(String(result.value.vehicleMassKg));
      setGearRatios(result.value.gearRatios.slice(1).map(String));
      setDrivetrainIssues([]);
    } else if ("issues" in result) {
      setDrivetrainIssues(result.issues);
    }
  }, [controller, gearRatios, snapshot.drivetrainConfig, vehicleMassKg]);

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
  const canStageDrivetrainConfig = snapshot.status === "idle";
  const firstInvalidPhaseIndex = draftConfig.cylinders.findIndex((_, index) =>
    Boolean(phaseIssue(validationIssues, index)),
  );
  const vehicleSpeedKmh = snapshot.telemetry.vehicleSpeedMps * 3.6;
  const displayVehicleSpeed = Number.isFinite(vehicleSpeedKmh)
    ? vehicleSpeedKmh.toFixed(1)
    : "—";
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
          <button
            type="button"
            onClick={start}
            disabled={isStartingOrRunning}
            aria-describedby={
              snapshot.status === "suspended"
                ? "transport-help suspension-notice"
                : "transport-help"
            }
          >
            Start audio
          </button>
          <button type="button" onClick={stop} disabled={!canStop}>
            Stop audio
          </button>
        </div>
        <p className="sr-only" id="transport-help">
          Starting audio requires an explicit action. If audio is paused while
          this page is hidden, select Start audio to resume it.
        </p>
        {snapshot.status === "suspended" ? (
          <p className="suspension-notice" id="suspension-notice">
            Audio is paused. Select Start audio to resume; returning to this
            page does not restart audio automatically.
          </p>
        ) : null}

        <div className="control-stack">
          <label className="drivetrain-control" htmlFor="drivetrain-gear">
            <span>Gear</span>
            <select
              id="drivetrain-gear"
              value={snapshot.drivetrainGear}
              onChange={(event) =>
                controller.setDrivetrainGear(Number(event.target.value))
              }
            >
              {snapshot.drivetrainConfig.gearRatios.map((_, index) => (
                <option key={index} value={index}>
                  {index === 0
                    ? "Neutral"
                    : `${index}${gearOrdinal(index)} gear`}
                </option>
              ))}
            </select>
          </label>

          <label className="range-control" htmlFor="clutch">
            <span>Clutch engagement</span>
            <input
              id="clutch"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={snapshot.clutch}
              aria-valuetext={`${Math.round(snapshot.clutch * 100)} percent engaged`}
              onChange={(event) =>
                controller.setClutch(Number(event.target.value))
              }
            />
            <output htmlFor="clutch" data-testid="clutch-value">
              {Math.round(snapshot.clutch * 100)}%
            </output>
          </label>

          <label className="range-control" htmlFor="volume">
            <span>Volume</span>
            <input
              id="volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={snapshot.volume}
              aria-valuetext={`${Math.round(snapshot.volume * 100)} percent`}
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
              aria-valuetext={`${Math.round(snapshot.throttle * 100)} percent`}
              onChange={(event) =>
                controller.setThrottle(Number(event.target.value))
              }
            />
            <output htmlFor="throttle" data-testid="throttle-value">
              {Math.round(snapshot.throttle * 100)}%
            </output>
          </label>

          <label className="number-control" htmlFor="throttle-percent">
            <span>Opening percentage</span>
            <input
              id="throttle-percent"
              type="number"
              min="0"
              max="100"
              step="1"
              inputMode="numeric"
              value={Math.round(snapshot.throttle * 100)}
              aria-valuetext={`${Math.round(snapshot.throttle * 100)} percent opening`}
              onChange={(event) =>
                controller.setThrottle(Number(event.target.value) / 100)
              }
            />
            <span aria-hidden="true">%</span>
          </label>

          <button
            type="button"
            className="hold-throttle"
            aria-label="Hold accelerator"
            onPointerDown={holdPointerThrottle}
            onPointerUp={(event) => releasePointerThrottle(event.pointerId)}
            onPointerCancel={(event) => releasePointerThrottle(event.pointerId)}
            onLostPointerCapture={(event) =>
              releasePointerThrottle(event.pointerId)
            }
          >
            Hold accelerator (Space)
          </button>

          <label className="range-control" htmlFor="dyno-load">
            <span>Dyno load</span>
            <input
              id="dyno-load"
              type="range"
              min="0"
              max={MAX_LOAD_TORQUE_NM}
              step="0.1"
              value={snapshot.loadTorqueNm}
              aria-valuetext={`${snapshot.loadTorqueNm.toFixed(1)} newton metres`}
              onChange={(event) =>
                controller.setLoadTorque(Number(event.target.value))
              }
            />
            <output htmlFor="dyno-load" data-testid="dyno-load-value">
              {snapshot.loadTorqueNm.toFixed(1)} N m
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
          className="drivetrain-config-editor"
          aria-labelledby="drivetrain-config-title"
        >
          <header className="config-editor-header">
            <div>
              <p className="eyebrow">Vehicle setup</p>
              <h2 id="drivetrain-config-title">Drivetrain configuration</h2>
            </div>
          </header>
          {drivetrainIssues.length > 0 ? (
            <ul className="validation-summary" role="alert">
              {drivetrainIssues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          <label className="phase-control" htmlFor="vehicle-mass">
            <span>Vehicle mass (kg)</span>
            <input
              id="vehicle-mass"
              type="number"
              min="1"
              max="100000"
              step="1"
              value={vehicleMassKg}
              disabled={!canStageDrivetrainConfig}
              aria-invalid={
                drivetrainIssues.some((issue) =>
                  issue.path.includes("vehicleMassKg"),
                ) || undefined
              }
              onChange={(event) => {
                setVehicleMassKg(event.target.value);
                setDrivetrainIssues([]);
              }}
            />
          </label>
          <fieldset disabled={!canStageDrivetrainConfig}>
            <legend>Forward gear ratios</legend>
            <div className="drivetrain-ratios">
              {gearRatios.map((ratio, index) => (
                <label
                  className="phase-control"
                  htmlFor={`gear-ratio-${index + 1}`}
                  key={index}
                >
                  <span>Gear {index + 1} ratio</span>
                  <input
                    id={`gear-ratio-${index + 1}`}
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.01"
                    value={ratio}
                    aria-invalid={
                      drivetrainIssues.some((issue) =>
                        issue.path.includes(`gearRatios[${index + 1}]`),
                      ) || undefined
                    }
                    onChange={(event) => {
                      setGearRatios((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      );
                      setDrivetrainIssues([]);
                    }}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={stageDrivetrainConfig}
            disabled={!canStageDrivetrainConfig}
          >
            Apply drivetrain settings
          </button>
        </section>

        <section
          className="config-editor"
          aria-labelledby="config-editor-title"
        >
          <header className="config-editor-header">
            <div>
              <p className="eyebrow">Configuration</p>
              <h2 id="config-editor-title">Engine configuration</h2>
            </div>
            <p className="config-state">
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

          <p className="cycle-description" data-testid="preset-limitations">
            Available presets: 1–4, 6, and 8 cylinders. Configuration limit: 8
            cylinders. Presets use synthetic model values, not measurements of
            real engines or vehicles.
          </p>

          <fieldset disabled={!canStageConfig}>
            <legend>燃焼位相（{draftConfig.cycleDegrees}°周期）</legend>
            <p className="cycle-description" data-testid="draft-cycle">
              {strokeCycleLabel(draftConfig.cycleDegrees)}
            </p>
            {validationIssues.length > 0 ? (
              <p className="validation-summary" role="alert">
                Configuration has {validationIssues.length} invalid phase
                {validationIssues.length === 1 ? "" : "s"}. Review the
                highlighted fields.
              </p>
            ) : null}
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
                      max={String(
                        Math.max(0, draftConfig.cycleDegrees - 0.001),
                      )}
                      step="any"
                      value={phases[index] ?? ""}
                      onChange={(event) =>
                        updatePhase(index, event.target.value)
                      }
                      aria-invalid={issue ? true : undefined}
                      aria-describedby={issue ? `${inputId}-error` : undefined}
                      ref={
                        index === firstInvalidPhaseIndex
                          ? firstInvalidPhaseRef
                          : undefined
                      }
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

          <button
            type="button"
            onClick={stageConfig}
            disabled={!canStageConfig}
          >
            Apply for next start
          </button>
        </section>

        <EngineVisualizations
          controller={controller}
          running={snapshot.status === "running"}
          activeConfig={snapshot.activeConfig}
        />

        <p className="status" role="status" aria-atomic="true">
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
            <dt>Vehicle speed</dt>
            <dd data-testid="vehicle-speed" aria-label="Vehicle speed">
              {displayVehicleSpeed} km/h
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

function gearOrdinal(gear: number): string {
  return gear === 1 ? "st" : gear === 2 ? "nd" : gear === 3 ? "rd" : "th";
}
