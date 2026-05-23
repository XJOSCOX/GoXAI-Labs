import type { FormEvent } from "react";

export function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function splitFullName(fullName: string) {
  const [firstName = "", ...rest] = fullName.split(/\s+/).filter(Boolean);

  return {
    firstName,
    lastName: rest.join(" ")
  };
}

export function getPasswordPolicyError(password: string) {
  const unmet = getPasswordChecks(password).find((check) => !check.met);

  return unmet ? `Password must include ${unmet.errorLabel}.` : null;
}

export function getPasswordChecks(password: string) {
  return [
    {
      label: "10 characters minimum",
      errorLabel: "at least 10 characters",
      met: password.length >= 10
    },
    {
      label: "Uppercase letter",
      errorLabel: "at least one uppercase letter",
      met: /[A-Z]/.test(password)
    },
    {
      label: "Lowercase letter",
      errorLabel: "at least one lowercase letter",
      met: /[a-z]/.test(password)
    },
    {
      label: "Number",
      errorLabel: "at least one number",
      met: /[0-9]/.test(password)
    },
    {
      label: "Letter",
      errorLabel: "at least one letter",
      met: /[A-Za-z]/.test(password)
    },
    {
      label: "Symbol",
      errorLabel: "at least one symbol",
      met: /[^A-Za-z0-9]/.test(password)
    }
  ];
}

export function getInitials(name: string, email: string) {
  const source = name !== "Signed in user" ? name : email;
  const parts = source
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);

  return (parts[0]?.[0] ?? "G").concat(parts[1]?.[0] ?? "X").toUpperCase();
}

export function formatAssetKind(mimeType: string) {
  const [kind] = mimeType.split("/");

  return kind ? formatEnum(kind) : "File";
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function formatBytes(value: string) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;

  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function getFormFile(event: FormEvent<HTMLFormElement>, name: string) {
  const form = new FormData(event.currentTarget);
  const value = form.get(name);

  return value instanceof File && value.size > 0 ? value : null;
}

export function getUrlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "unknown";
  }
}
