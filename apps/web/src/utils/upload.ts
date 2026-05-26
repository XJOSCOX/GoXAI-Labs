export function buildUploadObjectKey(
  file: File,
  options: {
    folder: string;
    prefix: string;
    rename: boolean;
  }
) {
  const folder = sanitizeObjectPath(options.folder);

  if (options.rename) {
    const prefix = toSafeObjectKeyPart(options.prefix) || "asset";
    return joinObjectKeyParts(folder, `${prefix}-${createRandomCode(getFileKey(file))}${getFileExtension(file.name)}`);
  }

  return joinObjectKeyParts(folder, sanitizeObjectPath(file.webkitRelativePath || file.name));
}

export function mergeFiles(current: File[], incoming: File[]) {
  const filesByKey = new Map(current.map((file) => [getFileKey(file), file]));

  for (const file of incoming) {
    filesByKey.set(getFileKey(file), file);
  }

  return Array.from(filesByKey.values());
}

export function getFileKey(file: File) {
  return `${file.webkitRelativePath || file.name}-${file.size}-${file.lastModified}`;
}

export function joinObjectKeyParts(...parts: string[]) {
  return parts.filter(Boolean).join("/");
}

export function sanitizeObjectPath(value: string) {
  return value
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function toSafeObjectKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function getFileExtension(fileName: string) {
  const cleanName = fileName.split(/[\\/]/).pop() ?? "";
  const dotIndex = cleanName.lastIndexOf(".");

  return dotIndex > 0 ? cleanName.slice(dotIndex).replace(/[^a-zA-Z0-9.]/g, "") : "";
}

export function createRandomCode(seed?: string) {
  if (seed) {
    let hash = 2166136261;

    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  const bytes = new Uint8Array(4);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return Math.random().toString(36).slice(2, 10);
}

export function createReadableCode(length = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }

  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
