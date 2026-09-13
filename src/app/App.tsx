import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  createBrowserAudioController,
  type AudioController,
} from "../audio/controller";

let browserAudioController: AudioController | undefined;

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

  const isStartingOrRunning =
    snapshot.status === "starting" || snapshot.status === "running";
  const canStop =
    snapshot.status === "starting" ||
    snapshot.status === "running" ||
    snapshot.status === "stopping" ||
    snapshot.status === "suspended";

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
