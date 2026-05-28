import { type PointerEvent, useEffect, useRef, useState } from "react";
import { formatMediaTime } from "../../assets/media";
import { clamp } from "../geometry";
import { type TemporalLabelControl, type TemporalRegionResponse } from "../templateForm";
import { TemporalSourceControls } from "../template/TemporalSourceControls";
export function AudioSourceCard({
  audioUrl,
  name,
  onAddTemporalRegion,
  temporalControls,
  temporalResponses
}: {
  audioUrl: string | null;
  name: string;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [activeControlName, setActiveControlName] = useState(temporalControls[0]?.name ?? "");
  const [activeLabel, setActiveLabel] = useState(temporalControls[0]?.labels[0]?.value ?? "");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [dragSelection, setDragSelection] = useState<{ end: number; start: number } | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const activeControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;
  const canSelectRange = Boolean(activeControl && duration > 0);
  const selectedRegionCount = activeControl ? temporalResponses[activeControl.name]?.length ?? 0 : 0;

  useEffect(() => {
    const nextControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;

    if (!nextControl) {
      setActiveControlName("");
      setActiveLabel("");
      return;
    }

    if (nextControl.name !== activeControlName) {
      setActiveControlName(nextControl.name);
    }

    if (!nextControl.labels.some((label) => label.value === activeLabel)) {
      setActiveLabel(nextControl.labels[0]?.value ?? "");
    }
  }, [activeControlName, activeLabel, temporalControls]);

  function seekBy(seconds: number) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.currentTime = Math.max(0, Math.min(duration || audio.duration || 0, audio.currentTime + seconds));
  }

  function updatePlaybackRate(nextRate: number) {
    const audio = audioRef.current;
    setPlaybackRate(nextRate);

    if (audio) {
      audio.playbackRate = nextRate;
    }
  }

  function getWaveformPercent(event: PointerEvent<HTMLDivElement>) {
    const element = waveformRef.current;

    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
  }

  function handleWaveformPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canSelectRange) {
      return;
    }

    const percent = getWaveformPercent(event);

    if (percent === null) {
      return;
    }

    setDragSelection({ end: percent, start: percent });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleWaveformPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragSelection) {
      return;
    }

    const percent = getWaveformPercent(event);

    if (percent === null) {
      return;
    }

    setDragSelection((current) => current ? { ...current, end: percent } : current);
  }

  function handleWaveformPointerUp() {
    if (!dragSelection || !activeControl || !activeLabel || duration <= 0) {
      setDragSelection(null);
      return;
    }

    const startPercent = Math.min(dragSelection.start, dragSelection.end);
    const endPercent = Math.max(dragSelection.start, dragSelection.end);

    if (endPercent - startPercent >= 0.006) {
      onAddTemporalRegion(activeControl.name, {
        end: (endPercent * duration).toFixed(2),
        label: activeLabel,
        start: (startPercent * duration).toFixed(2)
      });
    }

    setDragSelection(null);
  }

  return (
    <div className="template-source-card media-source-card audio-source-card">
      <div className="template-source-head">
        <div>
          <p className="eyebrow">{name}</p>
          <strong>Audio waveform workspace</strong>
        </div>
        <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
      </div>
      {audioUrl ? (
        <>
          <TemporalSourceControls
            activeControlName={activeControlName}
            activeLabel={activeLabel}
            controls={temporalControls}
            onControlChange={setActiveControlName}
            onLabelChange={setActiveLabel}
            regionCount={selectedRegionCount}
          />
          <div
            className={canSelectRange ? "audio-waveform-preview selectable" : "audio-waveform-preview"}
            onPointerDown={handleWaveformPointerDown}
            onPointerMove={handleWaveformPointerMove}
            onPointerUp={handleWaveformPointerUp}
            onPointerLeave={handleWaveformPointerUp}
            ref={waveformRef}
          >
            {Array.from({ length: 56 }, (_, index) => (
              <span key={index} style={{ height: `${22 + Math.round(Math.abs(Math.sin(index * 1.7)) * 44)}%` }} />
            ))}
            {dragSelection && (
              <div
                className="audio-waveform-selection"
                style={{
                  left: `${Math.min(dragSelection.start, dragSelection.end) * 100}%`,
                  width: `${Math.abs(dragSelection.end - dragSelection.start) * 100}%`
                }}
              />
            )}
          </div>
          <audio
            controls
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            ref={audioRef}
            src={audioUrl}
          />
          <div className="media-control-row">
            <button className="secondary-button compact-button" onClick={() => seekBy(-1)} type="button">-1s</button>
            <button className="secondary-button compact-button" onClick={() => seekBy(1)} type="button">+1s</button>
            <select value={playbackRate} onChange={(event) => updatePlaybackRate(Number(event.target.value))}>
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
            <a className="secondary-button compact-button" href={audioUrl} target="_blank" rel="noreferrer">Open source</a>
          </div>
        </>
      ) : (
        <p className="muted-copy">No audio source is available.</p>
      )}
    </div>
  );
}

