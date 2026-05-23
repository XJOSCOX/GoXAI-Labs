export const maxBulkUploadFiles = 250;
export const maxBulkUploadBytes = 1024 ** 3;
export const folderInputAttributes = { directory: "", webkitdirectory: "" } as Record<string, string>;

export const planOptions = [
  { value: "FREE", label: "Free", detail: "Start small", price: "$0" },
  { value: "STARTER", label: "Starter", detail: "Solo projects", price: "Basic" },
  { value: "PRO", label: "Pro", detail: "Growing teams", price: "Scale" },
  { value: "BUSINESS", label: "Business", detail: "Team controls", price: "Ops" },
  { value: "ENTERPRISE", label: "Enterprise", detail: "Custom needs", price: "Custom" }
];

export const memberRoles = ["OWNER", "ADMIN", "MANAGER", "REVIEWER", "ANNOTATOR", "VIEWER"];

export const rolePrivileges = [
  {
    role: "OWNER",
    permissions: ["Full organization control", "Manage owners and members", "Manage projects, datasets, assets, and tasks"]
  },
  {
    role: "ADMIN",
    permissions: ["Edit organization settings", "Manage non-owner members", "Manage projects, datasets, assets, and tasks"]
  },
  {
    role: "MANAGER",
    permissions: ["Manage projects and datasets", "Upload/register assets", "Generate and assign tasks"]
  },
  {
    role: "REVIEWER",
    permissions: ["Read workspace records", "Assign/start/submit tasks", "Reserved for review/QA tools"]
  },
  {
    role: "ANNOTATOR",
    permissions: ["Read workspace records", "Assign/start/submit tasks"]
  },
  {
    role: "VIEWER",
    permissions: ["Read-only access"]
  }
];

export const projectStatuses = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];
export const projectAccessModes = ["ORGANIZATION", "INVITE_ONLY", "PUBLIC", "PRIVATE"];
export const datasetStatuses = ["DRAFT", "IMPORTING", "READY", "PROCESSING", "ARCHIVED", "FAILED"];
