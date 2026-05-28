import type { TaskSummary } from "../../../../api";
import { AudioSourceCard } from "../sources/AudioSourceCard";
import { PdfSourceCard } from "../sources/PdfSourceCard";
import { TimeSeriesSourceCard } from "../sources/TimeSeriesSourceCard";
import { VideoSourceCard } from "../sources/VideoSourceCard";
import { getTemplateSourceValue, type TemplateSource, type TemporalLabelControl, type TemporalRegionResponse } from "../templateForm";
export function TemplateSourcePreview({
  accessUrl,
  onAddTemporalRegion,
  source,
  task,
  temporalControls,
  temporalResponses,
  textAssetContent
}: {
  accessUrl: string | null;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  source: TemplateSource;
  task: TaskSummary;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  textAssetContent: string | null;
}) {
  const sourceValue = getTemplateSourceValue(task, source, textAssetContent);
  const sourceTemporalControls = temporalControls.filter((control) => control.toName === source.name);

  if (source.type === "IMAGE") {
    const imageUrl = sourceValue || accessUrl;

    return (
      <div className="template-source-card image-source-card">
        <p className="eyebrow">{source.name}</p>
        {imageUrl ? (
          <img alt={task.asset?.fileName ?? source.name} src={imageUrl} />
        ) : (
          <p className="muted-copy">No image source is available.</p>
        )}
      </div>
    );
  }

  if (source.type === "VIDEO") {
    const videoUrl = sourceValue || accessUrl;

    return (
      <VideoSourceCard
        fileName={task.asset?.fileName ?? source.name}
        name={source.name}
        onAddTemporalRegion={onAddTemporalRegion}
        temporalControls={sourceTemporalControls}
        temporalResponses={temporalResponses}
        videoUrl={videoUrl}
      />
    );
  }

  if (source.type === "AUDIO") {
    const audioUrl = sourceValue || accessUrl;

    return (
      <AudioSourceCard
        audioUrl={audioUrl}
        name={source.name}
        onAddTemporalRegion={onAddTemporalRegion}
        temporalControls={sourceTemporalControls}
        temporalResponses={temporalResponses}
      />
    );
  }

  if (source.type === "PDF") {
    const pdfUrl = sourceValue || accessUrl;

    return (
      <PdfSourceCard
        name={source.name}
        onAddTemporalRegion={onAddTemporalRegion}
        pdfUrl={pdfUrl}
        temporalControls={sourceTemporalControls}
        temporalResponses={temporalResponses}
      />
    );
  }

  if (source.type === "TEXT") {
    return (
      <div className="template-source-card text-source-card">
        <p className="eyebrow">{source.name}</p>
        <div>{sourceValue || "No text source is available for this task."}</div>
      </div>
    );
  }

  if (source.type === "TIME_SERIES") {
    return (
      <TimeSeriesSourceCard
        name={source.name}
        onAddTemporalRegion={onAddTemporalRegion}
        sourceText={sourceValue || textAssetContent || ""}
        sourceUrl={accessUrl}
        temporalControls={sourceTemporalControls}
        temporalResponses={temporalResponses}
      />
    );
  }

  return (
    <div className="template-source-card">
      <p className="eyebrow">{source.name}</p>
      {accessUrl ? (
        <a className="secondary-button compact-button" href={accessUrl} target="_blank" rel="noreferrer">
          Open asset
        </a>
      ) : (
        <p className="muted-copy">No preview is available.</p>
      )}
    </div>
  );
}

