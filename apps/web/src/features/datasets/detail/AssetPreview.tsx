import { ExternalLink, FileText, X } from "lucide-react";
import { useEffect } from "react";

import { type AssetSummary } from "../../../api";
import { formatBytes, formatDate } from "../../../utils/format";

type AssetPreviewProps = {
  accessError: string | null;
  accessLoading: boolean;
  accessUrl: string | null;
  asset: AssetSummary;
  onClose: () => void;
};

export function AssetPreview({
  accessError,
  accessLoading,
  accessUrl,
  asset,
  onClose
}: AssetPreviewProps) {
  const isImage = asset.mimeType.startsWith("image/");
  const isVideo = asset.mimeType.startsWith("video/");
  const isAudio = asset.mimeType.startsWith("audio/");

  return (
    <section className="panel asset-preview">
      <div className="asset-preview-head">
        <div>
          <p className="eyebrow">Preview</p>
          <h2>{asset.fileName}</h2>
          <span>{asset.objectKey}</span>
        </div>
        <div className="asset-preview-actions">
          {accessUrl && (
            <a className="secondary-button compact-button" href={accessUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Open
            </a>
          )}
          <button className="ghost-button compact-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <dl className="detail-list asset-detail-list">
        <div>
          <dt>Type</dt>
          <dd>{asset.mimeType}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(asset.fileSize)}</dd>
        </div>
        <div>
          <dt>Dimensions</dt>
          <dd>{asset.width && asset.height ? `${asset.width} x ${asset.height}` : "Not set"}</dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>{formatDate(asset.createdAt)}</dd>
        </div>
      </dl>
      {accessError && <p className="form-error">{accessError}</p>}
      <div className="asset-preview-stage">
        {accessLoading ? (
          <span className="muted-copy">Creating signed preview URL.</span>
        ) : accessUrl && isImage ? (
          <img alt={asset.fileName} src={accessUrl} />
        ) : accessUrl && isVideo ? (
          <video controls src={accessUrl} />
        ) : accessUrl && isAudio ? (
          <audio controls src={accessUrl} />
        ) : (
          <div className="empty-state">
            <FileText size={28} />
            <strong>{accessUrl ? "Preview opens in a new tab" : "Preview unavailable"}</strong>
            <span>{accessUrl ? "Use Open to inspect this file." : "Select an asset to create a signed URL."}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function LargeAssetPreviewModal({
  accessError,
  accessLoading,
  accessUrl,
  asset,
  onClose
}: AssetPreviewProps) {
  const isImage = asset.mimeType.startsWith("image/");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop image-preview-backdrop" onMouseDown={onClose}>
      <section
        aria-label={`${asset.fileName} preview`}
        aria-modal="true"
        className="modal-panel image-preview-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="icon-button image-preview-close" type="button" onClick={onClose} aria-label="Close preview">
          <X size={20} />
        </button>
        {accessLoading ? (
          <span className="muted-copy">Creating signed preview URL.</span>
        ) : accessError ? (
          <p className="form-error">{accessError}</p>
        ) : accessUrl && isImage ? (
          <img alt={asset.fileName} src={accessUrl} />
        ) : (
          <div className="empty-state">
            <FileText size={28} />
            <strong>Image preview unavailable</strong>
            <span>This preview modal is built for image files.</span>
          </div>
        )}
      </section>
    </div>
  );
}
