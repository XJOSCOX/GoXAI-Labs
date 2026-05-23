export type UploadProgress = {
  completed: number;
  currentFile: string;
  failed: number;
  status: "uploading" | "complete" | "error";
  total: number;
};
