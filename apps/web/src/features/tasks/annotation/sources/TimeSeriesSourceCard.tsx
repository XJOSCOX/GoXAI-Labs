import { type PointerEvent, useEffect, useRef, useState } from "react";
import { buildTimeSeriesPreview, getTimeSeriesRowIndex } from "../../assets/timeSeries";
import { clamp } from "../geometry";
import { type TemporalLabelControl, type TemporalRegionResponse } from "../templateForm";
import { TemporalSourceControls } from "../template/TemporalSourceControls";
export function TimeSeriesSourceCard({
  name,
  onAddTemporalRegion,
  sourceText,
  sourceUrl,
  temporalControls,
  temporalResponses
}: {
  name: string;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  sourceText: string;
  sourceUrl: string | null;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [activeControlName, setActiveControlName] = useState(temporalControls[0]?.name ?? "");
  const [activeLabel, setActiveLabel] = useState(temporalControls[0]?.labels[0]?.value ?? "");
  const [dragSelection, setDragSelection] = useState<{ end: number; start: number } | null>(null);
  const preview = buildTimeSeriesPreview(sourceText);
  const activeControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;
  const canSelectRange = Boolean(activeControl && preview && preview.rows.length > 0);
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

  function getChartPercent(event: PointerEvent<HTMLDivElement>) {
    const element = chartRef.current;

    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
  }

  function handleChartPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canSelectRange) {
      return;
    }

    const percent = getChartPercent(event);

    if (percent === null) {
      return;
    }

    setDragSelection({ end: percent, start: percent });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleChartPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragSelection) {
      return;
    }

    const percent = getChartPercent(event);

    if (percent === null) {
      return;
    }

    setDragSelection((current) => current ? { ...current, end: percent } : current);
  }

  function handleChartPointerUp() {
    if (!dragSelection || !activeControl || !activeLabel || !preview) {
      setDragSelection(null);
      return;
    }

    const startPercent = Math.min(dragSelection.start, dragSelection.end);
    const endPercent = Math.max(dragSelection.start, dragSelection.end);
    const startIndex = getTimeSeriesRowIndex(startPercent, preview.rows.length);
    const endIndex = getTimeSeriesRowIndex(endPercent, preview.rows.length);
    const startRow = preview.rows[Math.min(startIndex, endIndex)];
    const endRow = preview.rows[Math.max(startIndex, endIndex)];

    if (startRow && endRow) {
      onAddTemporalRegion(activeControl.name, {
        end: endRow.label,
        label: activeLabel,
        start: startRow.label
      });
    }

    setDragSelection(null);
  }

  return (
    <div className="template-source-card time-series-source-card">
      <div className="template-source-head">
        <div>
          <p className="eyebrow">{name}</p>
          <strong>{preview ? preview.valueColumn : "Time series workspace"}</strong>
        </div>
        {sourceUrl && (
          <a className="secondary-button compact-button" href={sourceUrl} target="_blank" rel="noreferrer">
            Open source
          </a>
        )}
      </div>
      {preview ? (
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
            className={canSelectRange ? "time-series-chart-wrap selectable" : "time-series-chart-wrap"}
            onPointerDown={handleChartPointerDown}
            onPointerMove={handleChartPointerMove}
            onPointerUp={handleChartPointerUp}
            onPointerLeave={handleChartPointerUp}
            ref={chartRef}
          >
            <svg className="time-series-chart" preserveAspectRatio="none" viewBox="0 0 100 42">
              <polyline points={preview.polyline} />
            </svg>
            {dragSelection && (
              <div
                className="time-series-selection"
                style={{
                  left: `${Math.min(dragSelection.start, dragSelection.end) * 100}%`,
                  width: `${Math.abs(dragSelection.end - dragSelection.start) * 100}%`
                }}
              />
            )}
          </div>
          <div className="time-series-table">
            {preview.rows.slice(0, 8).map((row, index) => (
              <div key={`${row.label}-${index}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-source-card">
          <div>{sourceText || "No inline time series data is available. Open the source file to inspect it."}</div>
        </div>
      )}
    </div>
  );
}

