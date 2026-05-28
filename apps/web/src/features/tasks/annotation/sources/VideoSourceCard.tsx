import { useEffect, useRef, useState } from "react";
import { formatMediaTime } from "../../assets/media";
import { type TemporalLabelControl, type TemporalRegionResponse } from "../templateForm";
import { TemporalSourceControls } from "../template/TemporalSourceControls";
export function VideoSourceCard({
  fileName,
  name,
  onAddTemporalRegion,
  temporalControls,
  temporalResponses,
  videoUrl
}: {
  fileName: string;
  name: string;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  videoUrl: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeControlName, setActiveControlName] = useState(temporalControls[0]?.name ?? "");
  const [activeLabel, setActiveLabel] = useState(temporalControls[0]?.labels[0]?.value ?? "");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [segmentStart, setSegmentStart] = useState<number | null>(null);
  const activeControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;
  const selectedRegionCount = activeControl ? temporalResponses[activeControl.name]?.length ?? 0 : 0;

  useEffect(() => {
    const nextControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;

    if (!nextControl) {
      setActiveControlName("");
      setActiveLabel("");
      setSegmentStart(null);
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
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.currentTime = Math.max(0, Math.min(duration || video.duration || 0, video.currentTime + seconds));
  }

  function updatePlaybackRate(nextRate: number) {
    const video = videoRef.current;
    setPlaybackRate(nextRate);

    if (video) {
      video.playbackRate = nextRate;
    }
  }

  function captureSegmentStart() {
    setSegmentStart(currentTime);
  }

  function addCurrentTimestamp() {
    if (!activeControl || !activeLabel) {
      return;
    }

    const timestamp = currentTime.toFixed(2);
    onAddTemporalRegion(activeControl.name, {
      end: timestamp,
      label: activeLabel,
      start: timestamp
    });
  }

  function addSegmentEnd() {
    if (!activeControl || !activeLabel || segmentStart === null) {
      return;
    }

    const start = Math.min(segmentStart, currentTime);
    const end = Math.max(segmentStart, currentTime);

    if (end - start < 0.01) {
      addCurrentTimestamp();
    } else {
      onAddTemporalRegion(activeControl.name, {
        end: end.toFixed(2),
        label: activeLabel,
        start: start.toFixed(2)
      });
    }

    setSegmentStart(null);
  }

  return (
    <div className="template-source-card media-source-card video-source-card">
      <div className="template-source-head">
        <div>
          <p className="eyebrow">{name}</p>
          <strong>{fileName}</strong>
        </div>
        <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
      </div>
      {videoUrl ? (
        <>
          <TemporalSourceControls
            activeControlName={activeControlName}
            activeLabel={activeLabel}
            controls={temporalControls}
            onControlChange={setActiveControlName}
            onLabelChange={setActiveLabel}
            regionCount={selectedRegionCount}
          />
          <video
            controls
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            ref={videoRef}
            src={videoUrl}
          />
          <div className="media-control-row">
            <button className="secondary-button compact-button" onClick={() => seekBy(-1)} type="button">-1s</button>
            <button className="secondary-button compact-button" onClick={() => seekBy(1 / 30)} type="button">+1 frame</button>
            <button className="secondary-button compact-button" onClick={() => seekBy(1)} type="button">+1s</button>
            <button className="secondary-button compact-button" onClick={captureSegmentStart} disabled={!activeControl} type="button">Mark start</button>
            <button className="secondary-button compact-button" onClick={addSegmentEnd} disabled={!activeControl || segmentStart === null} type="button">
              {segmentStart === null ? "Mark end" : `End from ${formatMediaTime(segmentStart)}`}
            </button>
            <button className="secondary-button compact-button" onClick={addCurrentTimestamp} disabled={!activeControl} type="button">Add instant</button>
            <select value={playbackRate} onChange={(event) => updatePlaybackRate(Number(event.target.value))}>
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
            <a className="secondary-button compact-button" href={videoUrl} target="_blank" rel="noreferrer">Open source</a>
          </div>
        </>
      ) : (
        <p className="muted-copy">No video source is available.</p>
      )}
    </div>
  );
}

