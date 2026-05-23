export type UploadProgress = {
  completed: number;
  currentFile: string;
  currentFilePercent?: number;
  currentLoadedBytes?: number;
  currentTotalBytes?: number;
  failed: number;
  status: "uploading" | "complete" | "error";
  total: number;
};
