import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import type { AudioVisualizationSource } from "../audio/controller";
import type { EngineConfig } from "../engine/config";
import {
  drawSpectrum,
  drawWaveform,
  firingEventMarkers,
  nyquistLabel,
  resizeCanvasForDisplay,
  startVisualizationLoop,
} from "./visualization";

export interface VisualizationController {
  getVisualizationSource(): AudioVisualizationSource | null;
}

export interface EngineVisualizationsProps {
  readonly controller: VisualizationController;
  readonly running: boolean;
  /** The controller's applied configuration, never an editor draft. */
  readonly activeConfig: EngineConfig;
}

function currentPixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

export function EngineVisualizations({
  controller,
  running,
  activeConfig,
}: EngineVisualizationsProps) {
  const visualizationRef = useRef<HTMLDivElement>(null);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  const events = useMemo(
    () => firingEventMarkers(activeConfig),
    [activeConfig],
  );

  useEffect(() => {
    if (!running) return;
    const source = controller.getVisualizationSource();
    if (!source) return;
    const waveform = waveformRef.current;
    const spectrum = spectrumRef.current;
    const waveformContext = waveform?.getContext("2d") ?? null;
    const spectrumContext = spectrum?.getContext("2d") ?? null;

    const draw = (timeData: Uint8Array, frequencyData: Uint8Array) => {
      if (waveform && waveformContext) {
        resizeCanvasForDisplay(waveform, currentPixelRatio());
        drawWaveform(waveformContext, timeData);
      }
      if (spectrum && spectrumContext) {
        resizeCanvasForDisplay(spectrum, currentPixelRatio());
        drawSpectrum(spectrumContext, frequencyData);
      }
    };

    // Set the backing-store dimensions before the first analyser draw.
    if (waveform && waveformContext)
      resizeCanvasForDisplay(waveform, currentPixelRatio());
    if (spectrum && spectrumContext)
      resizeCanvasForDisplay(spectrum, currentPixelRatio());

    const resize = () => {
      if (waveform && waveformContext)
        resizeCanvasForDisplay(waveform, currentPixelRatio());
      if (spectrum && spectrumContext)
        resizeCanvasForDisplay(spectrum, currentPixelRatio());
    };
    const observer =
      typeof ResizeObserver === "undefined" || !visualizationRef.current
        ? null
        : new ResizeObserver(resize);
    if (observer && visualizationRef.current)
      observer.observe(visualizationRef.current);

    const cleanup = startVisualizationLoop({
      source,
      scheduler: {
        requestAnimationFrame: (callback) => requestAnimationFrame(callback),
        cancelAnimationFrame: (handle) => cancelAnimationFrame(handle),
      },
      draw,
      disconnectResize: () => observer?.disconnect(),
    });

    return () => {
      cleanup?.();
      if (!cleanup) observer?.disconnect();
    };
  }, [controller, running]);

  return (
    <section
      className="engine-visualizations"
      aria-label="Engine visualizations"
    >
      <section
        className="firing-event-strip"
        aria-label="720 degree firing events"
      >
        <h2>720° firing events</h2>
        <ol className="firing-event-track" data-testid="firing-event-strip">
          {events.map((event) => (
            <li
              key={`${event.id}-${event.order}`}
              data-testid="firing-event"
              data-angle-deg={event.angleDeg}
              data-position-percent={`${event.positionPercent}%`}
              data-lane={event.lane}
              style={
                {
                  "--event-position": `${event.positionPercent}%`,
                  "--event-lane": event.lane,
                  "--event-translation":
                    event.positionPercent < 2
                      ? "0"
                      : event.positionPercent > 98
                        ? "-100%"
                        : "-50%",
                } as CSSProperties
              }
              aria-label={`${event.id}, ${event.angleDeg} degrees`}
            >
              {event.shortLabel}
            </li>
          ))}
        </ol>
        <ol className="firing-event-legend" aria-label="Firing event legend">
          {events.map((event) => (
            <li
              key={`${event.id}-${event.order}`}
              data-testid="firing-event-label"
            >
              {event.id}: {event.angleDeg}°
            </li>
          ))}
        </ol>
      </section>
      <div className="analyser-figures" ref={visualizationRef}>
        <figure className="analyser-figure waveform-figure">
          <figcaption>Waveform</figcaption>
          <canvas
            ref={waveformRef}
            data-testid="waveform-canvas"
            aria-label="Current audio waveform"
          />
        </figure>
        <figure className="analyser-figure spectrum-figure">
          <figcaption>
            Frequency spectrum:{" "}
            {nyquistLabel(controller.getVisualizationSource()?.sampleRate ?? 0)}
          </figcaption>
          <canvas
            ref={spectrumRef}
            data-testid="spectrum-canvas"
            aria-label="Current audio frequency spectrum"
          />
        </figure>
      </div>
    </section>
  );
}
