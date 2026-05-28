import { Eye, HardDrive, Maximize2, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { deleteAssets, type AssetSummary } from "../../../api";
import { formatAssetKind, formatBytes } from "../../../utils/format";
import { type AuthSession } from "../../shared/resourceSession";
import { getAssetFolderPrefix } from "./datasetDetailUtils";

const assetPageSize = 12;

type AssetsTableProps = {
  assets: AssetSummary[];
  canManageAssets: boolean;
  datasetId: string;
  loading: boolean;
  onChanged: () => Promise<void>;
  onDeleted: (input: { assetIds?: string[]; folderPrefix?: string }) => void;
  onInspectAsset: (asset: AssetSummary) => void;
  onPreviewAsset: (asset: AssetSummary) => void;
  session: AuthSession;
  setPageError: (error: string | null) => void;
};

export function AssetsTable({
  assets,
  canManageAssets,
  datasetId,
  loading,
  onChanged,
  onDeleted,
  onInspectAsset,
  onPreviewAsset,
  session,
  setPageError
}: AssetsTableProps) {
  const [query, setQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [folderPrefix, setFolderPrefix] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAssets = normalizedQuery
    ? assets.filter((asset) =>
        [asset.fileName, asset.objectKey, asset.mimeType, asset.provider]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : assets;
  const pageCount = Math.max(1, Math.ceil(filteredAssets.length / assetPageSize));
  const pageStart = (currentPage - 1) * assetPageSize;
  const pageAssets = filteredAssets.slice(pageStart, pageStart + assetPageSize);
  const pageEnd = pageStart + pageAssets.length;
  const visiblePageStart = filteredAssets.length > 0 ? pageStart + 1 : 0;
  const totalBytes = assets.reduce((total, asset) => total + Number(asset.fileSize || 0), 0);
  const folderOptions = [
    ...new Set(assets.map((asset) => getAssetFolderPrefix(asset.objectKey)).filter((prefix) => prefix.length > 0))
  ].sort();
  const selectedPageAssets = pageAssets.filter((asset) => selectedAssetIds.includes(asset.id));
  const selectedPageCount = selectedPageAssets.length;
  const allPageSelected = pageAssets.length > 0 && pageAssets.every((asset) => selectedAssetIds.includes(asset.id));

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedQuery, assets.length]);

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  function toggleAsset(assetId: string, checked: boolean) {
    if (!canManageAssets) {
      return;
    }

    setSelectedAssetIds((current) =>
      checked ? [...new Set([...current, assetId])] : current.filter((selectedId) => selectedId !== assetId)
    );
  }

  function toggleVisibleAssets(checked: boolean) {
    if (!canManageAssets) {
      return;
    }

    const visibleIds = pageAssets.map((asset) => asset.id);

    setSelectedAssetIds((current) =>
      checked ? [...new Set([...current, ...visibleIds])] : current.filter((selectedId) => !visibleIds.includes(selectedId))
    );
  }

  async function handleDeleteSelected() {
    if (selectedAssetIds.length === 0 || deleting) {
      return;
    }

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedAssetIds.length} selected registered file${selectedAssetIds.length === 1 ? "" : "s"} from R2 and this dataset?`
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setDeleteMessage(null);
    setPageError(null);

    try {
      const deletedAssetIds = selectedAssetIds;
      const result = await deleteAssets(session, { assetIds: deletedAssetIds });
      setSelectedAssetIds([]);
      onDeleted({ assetIds: deletedAssetIds });
      await onChanged();
      setDeleteMessage(`Deleted ${result.deletedCount} registered file${result.deletedCount === 1 ? "" : "s"}.`);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to delete selected files.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteOne(asset: AssetSummary) {
    if (!session || deleting) {
      setPageError(session ? null : "Authentication required.");
      return;
    }

    const confirmed = window.confirm(`Delete ${asset.fileName} from R2 and this dataset?`);

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setDeleteMessage(null);
    setPageError(null);

    try {
      await deleteAssets(session, { assetIds: [asset.id] });
      setSelectedAssetIds((current) => current.filter((assetId) => assetId !== asset.id));
      onDeleted({ assetIds: [asset.id] });
      await onChanged();
      setDeleteMessage("File deleted.");
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to delete file.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteFolder() {
    if (!folderPrefix || deleting) {
      return;
    }

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const matchingCount = assets.filter((asset) => asset.objectKey.startsWith(folderPrefix)).length;
    const confirmed = window.confirm(
      `Delete ${matchingCount} registered file${matchingCount === 1 ? "" : "s"} from folder ${folderPrefix}? This only deletes registered files you can manage.`
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setDeleteMessage(null);
    setPageError(null);

    try {
      const result = await deleteAssets(session, { datasetId, folderPrefix });
      setFolderPrefix("");
      setSelectedAssetIds([]);
      onDeleted({ folderPrefix });
      await onChanged();
      setDeleteMessage(`Deleted ${result.deletedCount} registered file${result.deletedCount === 1 ? "" : "s"} from ${folderPrefix}.`);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to delete folder files.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="asset-workspace">
      <div className="asset-toolbar">
        <div>
          <p className="eyebrow">Assets</p>
          <h2>{assets.length} registered</h2>
          <span>{formatBytes(String(totalBytes))} across this dataset</span>
        </div>
        <div className="asset-toolbar-actions">
          {canManageAssets && selectedAssetIds.length > 0 && (
            <button className="ghost-button danger-button compact-button" type="button" onClick={handleDeleteSelected} disabled={deleting}>
              <Trash2 size={16} />
              Delete selected ({selectedAssetIds.length})
            </button>
          )}
          <label className="search-field">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files, keys, or MIME types"
            />
          </label>
        </div>
      </div>
      {canManageAssets && folderOptions.length > 0 && (
        <div className="folder-delete-bar">
          <label>
            Delete registered folder
            <select value={folderPrefix} onChange={(event) => setFolderPrefix(event.target.value)}>
              <option value="">Choose folder prefix</option>
              {folderOptions.map((prefix) => (
                <option key={prefix} value={prefix}>
                  {prefix}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button danger-button compact-button" type="button" onClick={handleDeleteFolder} disabled={!folderPrefix || deleting}>
            <Trash2 size={16} />
            Delete folder files
          </button>
        </div>
      )}
      {deleteMessage && <p className="form-success">{deleteMessage}</p>}
      <section className="table-panel">
        <div className="table-row assets-head table-head">
          <span>
            {canManageAssets ? (
              <input
                aria-label="Select assets on this page"
                checked={allPageSelected}
                disabled={pageAssets.length === 0}
                onChange={(event) => toggleVisibleAssets(event.currentTarget.checked)}
                type="checkbox"
              />
            ) : null}
          </span>
          <span>File</span>
          <span>Type</span>
          <span>Size</span>
          <span>Action</span>
        </div>
        {selectedPageCount > 0 && (
          <div className="selection-summary">
            {selectedPageCount} file{selectedPageCount === 1 ? "" : "s"} selected on this page.
          </div>
        )}
        {loading ? (
          <div className="empty-state">
            <HardDrive size={28} />
            <strong>Loading assets</strong>
            <span>Checking registered R2 objects for this dataset.</span>
          </div>
        ) : filteredAssets.length > 0 ? (
          pageAssets.map((asset) => (
            <AssetRow
              asset={asset}
              canManageAssets={canManageAssets}
              checked={selectedAssetIds.includes(asset.id)}
              key={asset.id}
              onDelete={() => {
                void handleDeleteOne(asset);
              }}
              onInspect={() => {
                onInspectAsset(asset);
              }}
              onPreview={() => {
                onPreviewAsset(asset);
              }}
              onToggle={(checked) => toggleAsset(asset.id, checked)}
            />
          ))
        ) : assets.length > 0 ? (
          <div className="empty-state">
            <Search size={28} />
            <strong>No matching assets</strong>
            <span>Try a file name, object key, provider, or MIME type.</span>
          </div>
        ) : (
          <div className="empty-state">
            <HardDrive size={28} />
            <strong>No assets registered</strong>
            <span>Upload an R2 object to start building annotation tasks.</span>
          </div>
        )}
        {filteredAssets.length > assetPageSize && (
          <div className="pagination-bar">
            <span>
              Showing {visiblePageStart}-{pageEnd} of {filteredAssets.length}
            </span>
            <div>
              <button
                className="secondary-button compact-button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {pageCount}
              </span>
              <button
                className="secondary-button compact-button"
                disabled={currentPage === pageCount}
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

type AssetRowProps = {
  asset: AssetSummary;
  canManageAssets: boolean;
  checked: boolean;
  onDelete: () => void;
  onInspect: () => void;
  onPreview: () => void;
  onToggle: (checked: boolean) => void;
};

function AssetRow({
  asset,
  canManageAssets,
  checked,
  onDelete,
  onInspect,
  onPreview,
  onToggle
}: AssetRowProps) {
  return (
    <article className="table-row assets-head project-row">
      <span>
        {canManageAssets ? (
          <input
            aria-label={`Select ${asset.fileName}`}
            checked={checked}
            onChange={(event) => onToggle(event.currentTarget.checked)}
            type="checkbox"
          />
        ) : null}
      </span>
      <span>
        <button className="link-button" type="button" onClick={onInspect}>
          {asset.fileName}
        </button>
        <small>{asset.objectKey}</small>
      </span>
      <span>
        <span className="status-pill compact">{formatAssetKind(asset.mimeType)}</span>
        <small>{asset.mimeType}</small>
      </span>
      <span>{formatBytes(asset.fileSize)}</span>
      <span>
        <div className="asset-row-actions">
          <button className="icon-button asset-action-button" type="button" onClick={onInspect} aria-label="Quick preview" title="Quick preview">
            <Eye size={16} />
          </button>
          <button className="icon-button asset-action-button" type="button" onClick={onPreview} aria-label="Preview" title="Preview">
            <Maximize2 size={16} />
          </button>
          {canManageAssets ? (
            <button className="icon-button asset-action-button danger-action-button" type="button" onClick={onDelete} aria-label="Delete" title="Delete">
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </span>
    </article>
  );
}
