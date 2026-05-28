import { useEffect, useState } from "react";
import { type TemporalLabelControl, type TemporalRegionResponse } from "../templateForm";
import { TemporalSourceControls } from "../template/TemporalSourceControls";
export function PdfSourceCard({
  name,
  onAddTemporalRegion,
  pdfUrl,
  temporalControls,
  temporalResponses
}: {
  name: string;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  pdfUrl: string | null;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
}) {
  const [activeControlName, setActiveControlName] = useState(temporalControls[0]?.name ?? "");
  const [activeLabel, setActiveLabel] = useState(temporalControls[0]?.labels[0]?.value ?? "");
  const [activePage, setActivePage] = useState(1);
  const activeControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;
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

  function addPageMarker() {
    if (!activeControl || !activeLabel) {
      return;
    }

    const page = Math.max(1, Math.round(activePage));
    onAddTemporalRegion(activeControl.name, {
      end: String(page),
      label: activeLabel,
      page,
      start: String(page)
    });
  }

  return (
    <div className="template-source-card pdf-source-card">
      <div className="template-source-head">
        <div>
          <p className="eyebrow">{name}</p>
          <strong>Document workspace</strong>
        </div>
        {pdfUrl && (
          <a className="secondary-button compact-button" href={pdfUrl} target="_blank" rel="noreferrer">
            Open source
          </a>
        )}
      </div>
      {pdfUrl ? (
        <>
          <TemporalSourceControls
            activeControlName={activeControlName}
            activeLabel={activeLabel}
            controls={temporalControls}
            onControlChange={setActiveControlName}
            onLabelChange={setActiveLabel}
            regionCount={selectedRegionCount}
          />
          {activeControl && (
            <div className="pdf-page-marker-controls">
              <label>
                Page
                <input
                  min={1}
                  onChange={(event) => setActivePage(Number(event.target.value))}
                  type="number"
                  value={activePage}
                />
              </label>
              <button className="secondary-button compact-button" onClick={addPageMarker} type="button">Add page marker</button>
            </div>
          )}
          <iframe src={pdfUrl} title={name} />
        </>
      ) : (
        <p className="muted-copy">No PDF source is available.</p>
      )}
    </div>
  );
}

