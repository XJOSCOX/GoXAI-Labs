import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

export interface ApiUser {
  id: string;
  supabaseAuthId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  referralCode: string | null;
  apiCode: string | null;
  isVerified: boolean;
  verificationStatus: string;
  creatorStatus: string;
  verifiedAt: string | null;
  verifiedById: string | null;
  globalRole: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendConfig {
  supabase: {
    url: string;
    anonKey: string;
  };
}

export interface UserApplicationSummary {
  id: string;
  userId: string;
  status: string;
  reason: string;
  intendedUse: string | null;
  reviewerNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  jobTitle: string | null;
  isVerified: boolean;
  verificationStatus: string;
  creatorStatus: string;
  globalRole: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminApplicationSummary extends UserApplicationSummary {
  type: "verification" | "creator";
  user: AdminUserSummary | null;
}

export interface AdminOverview {
  counts: {
    users: number;
    pendingVerification: number;
    verifiedUsers: number;
    pendingCreators: number;
    approvedCreators: number;
    organizations: number;
    projects: number;
    datasets: number;
  };
  users: AdminUserSummary[];
  verificationApplications: AdminApplicationSummary[];
  creatorApplications: AdminApplicationSummary[];
}

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

let supabaseBrowserClientPromise: Promise<SupabaseClient> | null = null;

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  description: string | null;
  onboardingComplete: boolean;
  type: string;
  accessMode: string;
  joinCode?: string | null;
  joinCodeEnabled: boolean;
  joinRequiresApproval: boolean;
  planTier: string;
  role: string;
  capabilities: OrganizationCapabilities;
  counts: {
    owners: number;
    members: number;
    projects: number;
    datasets: number;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationCapabilities {
  canUpdate: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  canGrantOwnerRole: boolean;
  canCreateProjects: boolean;
  canViewMembers: boolean;
}

export interface MembershipSummary {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  role: string;
  status: string;
  joinedAt: string | null;
  user: {
    id: string;
    email: string;
    name: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationDetail extends Omit<OrganizationSummary, "role" | "workspace"> {
  currentUserRole: string;
  workspaces: Array<{
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  memberships: MembershipSummary[];
}

export interface CreateOrganizationInput {
  organizationName: string;
  workspaceName: string;
  organizationEmail?: string;
  description?: string;
  organizationType: string;
  planTier: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  email?: string;
  description?: string;
  type?: string;
  accessMode?: string;
  joinCodeEnabled?: boolean;
  joinRequiresApproval?: boolean;
  planTier?: string;
  completeOnboarding?: boolean;
}

export interface AddMemberInput {
  email: string;
  role: string;
}

export interface UpdateMemberInput {
  role?: string;
  status?: string;
}

export interface ProjectSummary {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdById: string;
  name: string;
  slug: string;
  description: string | null;
  dataType: string;
  status: string;
  accessMode: string;
  memberLimit: number | null;
  allowExternalMembers: boolean;
  joinCode: string | null;
  joinCodeEnabled: boolean;
  instructions: string | null;
  currentUserRole: string | null;
  canManage: boolean;
  canCreateDataset: boolean;
  counts: {
    members: number;
    datasets: number;
    tasks: number;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  organizationId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  dataType: string;
  accessMode?: string;
  memberLimit?: number;
  allowExternalMembers?: boolean;
  joinCodeEnabled?: boolean;
  instructions?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: string;
  accessMode?: string;
  memberLimit?: number | null;
  allowExternalMembers?: boolean;
  joinCodeEnabled?: boolean;
  instructions?: string;
}

export interface AnnotationTemplateSummary {
  canManage?: boolean;
  category?: {
    id: string;
    name: string;
    organizationId: string | null;
  } | null;
  categoryId: string | null;
  id: string;
  name: string;
  description: string | null;
  dataType: string;
  configJson: Record<string, unknown>;
  organization?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  organizationId?: string | null;
  subtype?: string | null;
}

export interface BuiltInAnnotationTemplateSummary {
  category: string;
  categoryId: string;
  configCode: string;
  configJson: Record<string, unknown>;
  configPath: string;
  dataType: string;
  description: string;
  details: string | null;
  id: string;
  image: string | null;
  labels: string[];
  name: string;
  order: number;
  source: "builtin";
  sourceRepo: string | null;
  subtype: string;
  tools: string[];
  type: string;
}

export interface BuiltInAnnotationTemplateGroup {
  description: string;
  id: string;
  name: string;
  order: number;
}

export interface AnnotationCategorySummary {
  canManage: boolean;
  createdAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  description: string | null;
  id: string;
  name: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  organizationId: string | null;
  templateCount: number;
  updatedAt: string;
}

export interface DatasetLabelSummary {
  id: string;
  name: string;
  color: string;
  shortcutKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetToolSummary {
  id: string;
  tool: string;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetLabelInput {
  color?: string;
  name: string;
  shortcutKey?: string;
}

export interface DatasetToolInput {
  configJson?: Record<string, unknown>;
  enabled?: boolean;
  tool: string;
}

export interface DatasetSummary {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  annotationTemplateId: string | null;
  labelingConfig: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  annotationTemplate: AnnotationTemplateSummary | null;
  labels: DatasetLabelSummary[];
  tools: DatasetToolSummary[];
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
    dataType: string;
    status: string;
    createdById?: string;
  };
  canManage: boolean;
  canManageAssets: boolean;
  canGenerateTasks: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetVersionSummary {
  id: string;
  datasetId: string;
  version: number;
  summary: {
    reason: string;
    labelCount: number;
    toolCount: number;
    assetCount: number;
    taskCount: number;
    datasetName: string;
    datasetStatus: string;
    templateName: string | null;
    restoredFromVersion: number | null;
  };
  createdById: string | null;
  createdBy: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  createdAt: string;
}

export interface CreateDatasetInput {
  projectId: string;
  name: string;
  description?: string;
}

export interface UpdateDatasetInput {
  name?: string;
  description?: string;
  annotationTemplateId?: string | null;
  status?: string;
  labelingConfig?: Record<string, unknown> | null;
  labels?: DatasetLabelInput[];
  tools?: DatasetToolInput[];
}

export interface AssetSummary {
  id: string;
  organizationId: string;
  projectId: string | null;
  datasetId: string | null;
  provider: string;
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  metadata: Record<string, unknown> | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
  } | null;
  dataset: {
    id: string;
    name: string;
    version: number;
    labelingConfig: Record<string, unknown> | null;
    labels: DatasetLabelSummary[];
    tools: DatasetToolSummary[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetInput {
  datasetId: string;
  bucket?: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
  checksum?: string;
  width?: string;
  height?: string;
  duration?: string;
  metadata?: Record<string, unknown>;
}

export interface AssetUploadRequest {
  datasetId: string;
  objectKey?: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
}

export interface AssetUploadUrl {
  upload: {
    uploadUrl: string;
    method: "PUT";
    expiresInSeconds: number;
    headers: Record<string, string>;
  };
  asset: CreateAssetInput;
}

export interface MultipartUploadPartUrl {
  uploadUrl: string;
  method: "PUT";
  expiresInSeconds: number;
  headers: Record<string, string>;
  partNumber: number;
}

export interface AssetMultipartUpload {
  upload: {
    bucket: string;
    objectKey: string;
    uploadId: string;
    partSize: number;
    partCount: number;
    expiresInSeconds: number;
    parts: MultipartUploadPartUrl[];
  };
  asset: CreateAssetInput;
}

export interface CompletedMultipartPart {
  etag: string;
  partNumber: number;
}

export interface AssetAccessUrl {
  accessUrl: string;
  expiresInSeconds: number;
}

export interface ExportJobSummary {
  completedAt: string | null;
  createdAt: string;
  dataset: {
    id: string;
    name: string;
    version: number;
  } | null;
  datasetId: string | null;
  errorMessage: string | null;
  format: string;
  id: string;
  metadata: Record<string, unknown> | null;
  outputAsset: {
    id: string;
    bucket: string;
    fileName: string;
    fileSize: string;
    mimeType: string;
    objectKey: string;
    provider: string;
  } | null;
  outputAssetId: string | null;
  project: {
    id: string;
    name: string;
    slug: string;
  };
  projectId: string;
  requestedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  requestedById: string | null;
  startedAt: string | null;
  status: string;
  updatedAt: string;
}

export type ExportFormat = "ASR_JSONL" | "COCO" | "CONLL_2003" | "CSV" | "JSON" | "JSON_MIN" | "PASCAL_VOC" | "TSV" | "YOLO";

export interface ExportDownloadUrl {
  downloadUrl: string;
  expiresInSeconds: number;
  export: ExportJobSummary;
}

export interface DeleteAssetsResult {
  deletedCount: number;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  datasetId: string | null;
  assetId: string | null;
  status: string;
  priority: number;
  assignedToId: string | null;
  reviewerId: string | null;
  metadata: Record<string, unknown> | null;
  dueAt: string | null;
  project: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
    status: string;
  };
  dataset: {
    id: string;
    name: string;
    version: number;
    labelingConfig: Record<string, unknown> | null;
    labels: DatasetLabelSummary[];
    tools: DatasetToolSummary[];
  } | null;
  asset: {
    id: string;
    fileName: string;
    objectKey: string;
    mimeType: string;
    fileSize: string;
    width: number | null;
    height: number | null;
    metadata: Record<string, unknown> | null;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
  reviewer: {
    id: string;
    email: string;
    name: string;
  } | null;
  canManage: boolean;
  canReview: boolean;
  canWork: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationRegionSummary {
  id: string;
  type: string;
  label: string | null;
  geometryJson: Record<string, unknown>;
  confidence: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationSummary {
  id: string;
  taskId: string;
  projectId: string;
  userId: string;
  status: string;
  resultJson: Record<string, unknown>;
  leadTimeSeconds: number | null;
  version: number;
  submittedAt: string | null;
  user: {
    id: string;
    email: string;
    name: string;
  };
  regions: AnnotationRegionSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  annotation: {
    id: string;
    status: string;
    version: number;
  };
  annotationId: string;
  createdAt: string;
  feedback: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  reviewer: {
    id: string;
    email: string;
    name: string;
  };
  reviewerId: string;
  score: number | null;
  status: string;
  taskId: string;
  updatedAt: string;
}

export interface CommentSummary {
  annotationId: string | null;
  body: string;
  createdAt: string;
  id: string;
  metadata: Record<string, unknown> | null;
  parentId: string | null;
  resolved: boolean;
  taskId: string | null;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  userId: string;
}

export interface TaskDetailResult {
  annotation: AnnotationSummary | null;
  annotationHistory: AnnotationSummary[];
  comments: CommentSummary[];
  reviews: ReviewSummary[];
  task: TaskSummary;
}

export interface NextTaskResult {
  task: TaskSummary | null;
}

export interface ReviewTaskResult {
  annotation: AnnotationSummary | null;
  comment: CommentSummary | null;
  review: ReviewSummary;
  task: TaskSummary;
}

export interface SaveAnnotationInput {
  leadTimeSeconds?: number;
  results?: {
    fromName: string;
    toName: string;
    type: string;
    value: Record<string, unknown>;
  }[];
  regions: {
    geometry:
      | {
          height: number;
          ocrBlockId?: string;
          page?: number;
          sourceName?: string;
          text?: string;
          width: number;
          x: number;
          y: number;
        }
      | {
          ocrBlockId?: string;
          page?: number;
          points: {
            x: number;
            y: number;
          }[];
          sourceName?: string;
          text?: string;
        };
    label?: string | null;
    type?: string;
  }[];
}

export interface GenerateTasksResult {
  createdCount: number;
  skippedCount: number;
  remainingCount?: number;
  tasks: TaskSummary[];
}

export interface DatasetWorkflowResult {
  tasks: TaskSummary[];
  updatedCount: number;
}

export interface DatasetAssignmentResult {
  assignedCount: number;
}

export interface TaskParticipantSummary {
  canReview: boolean;
  canWork: boolean;
  email: string;
  id: string;
  name: string;
  roles: string[];
}

export interface TaskWorkflowInput {
  assignmentMode?: "round_robin" | "single" | "unassigned";
  assignedToId?: string | null;
  assigneeIds?: string[];
  dueAt?: string | null;
  priority?: number;
  reviewerId?: string | null;
  saveDefaults?: boolean;
}

export interface TaskPageResult {
  page: number;
  pageSize: number;
  tasks: TaskSummary[];
  total: number;
  totalPages: number;
}

export type TaskAssignmentFilter = "all" | "mine" | "unassigned";
export type TaskDueFilter = "any" | "overdue" | "soon" | "none";

export interface TaskQueueFilters {
  assignment?: TaskAssignmentFilter;
  due?: TaskDueFilter;
  minPriority?: number;
  search?: string;
  status?: string;
}

export interface TaskProjectFolderSummary {
  active: number;
  approved: number;
  datasetCount: number;
  done: number;
  pending: number;
  projectId: string;
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  rejected: number;
  review: number;
  total: number;
  unassigned: number;
}

export interface TaskDatasetFolderSummary {
  active: number;
  approved: number;
  datasetId: string;
  datasetName: string;
  done: number;
  pending: number;
  projectId: string;
  projectName: string;
  projectSlug: string;
  readyLabel: string;
  rejected: number;
  review: number;
  total: number;
  unassigned: number;
  versionLabel: string;
}

export interface TaskFoldersResult {
  datasets?: TaskDatasetFolderSummary[];
  project?: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  projects?: TaskProjectFolderSummary[];
}

export interface TaskStatsSummary {
  active: number;
  approved: number;
  done: number;
  pending: number;
  rejected: number;
  review: number;
  total: number;
  unassigned: number;
}

export interface ClientLogInput {
  entityId?: string;
  entityType?: string;
  event: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

export async function createSupabaseBrowserClient() {
  if (supabaseBrowserClientPromise) {
    return supabaseBrowserClientPromise;
  }

  supabaseBrowserClientPromise = createSupabaseBrowserClientFromApi();

  return supabaseBrowserClientPromise;
}

async function createSupabaseBrowserClientFromApi() {
  const response = await fetch(`${apiUrl}/api/config`);

  if (!response.ok) {
    throw new Error("Unable to load Supabase configuration from the API.");
  }

  const config = (await response.json()) as BackendConfig;

  return createClient(config.supabase.url, config.supabase.anonKey);
}

export async function syncAuthenticatedUser(session: Session) {
  const response = await fetch(`${apiUrl}/api/auth/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Unable to sync authenticated user.");
  }

  return ((await response.json()) as { user: ApiUser }).user;
}

export async function resolveLoginEmail(identifier: string) {
  const params = new URLSearchParams({ identifier });
  const response = await fetch(`${apiUrl}/api/auth/login-identifier?${params.toString()}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to resolve login email."));
  }

  return ((await response.json()) as { email: string }).email;
}

export async function updateUserProfile(
  session: Session,
  input: { firstName?: string; lastName?: string; jobTitle?: string }
) {
  const response = await authenticatedFetch(session, "/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update profile."));
  }

  return ((await response.json()) as { user: ApiUser }).user;
}

export async function getMyApplications(session: Session) {
  const response = await authenticatedFetch(session, "/api/applications/me");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load applications."));
  }

  return (await response.json()) as {
    verificationApplication: UserApplicationSummary | null;
    creatorApplication: UserApplicationSummary | null;
  };
}

export async function submitVerificationApplication(
  session: Session,
  input: { fullName: string; reason: string; intendedUse?: string }
) {
  const response = await authenticatedFetch(session, "/api/applications/verification", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to submit verification application."));
  }

  return ((await response.json()) as { application: UserApplicationSummary }).application;
}

export async function submitCreatorApplication(session: Session, input: { reason: string; intendedUse?: string }) {
  const response = await authenticatedFetch(session, "/api/applications/creator", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to submit creator application."));
  }

  return ((await response.json()) as { application: UserApplicationSummary }).application;
}

export async function getAdminOverview(session: Session) {
  const response = await authenticatedFetch(session, "/api/admin/overview");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load admin panel."));
  }

  return (await response.json()) as AdminOverview;
}

export async function reviewAdminApplication(
  session: Session,
  type: "verification" | "creator",
  applicationId: string,
  decision: "approve" | "reject",
  reviewerNotes?: string
) {
  const response = await authenticatedFetch(
    session,
    `/api/admin/applications/${type}/${encodeURIComponent(applicationId)}/${decision}`,
    {
      method: "POST",
      body: JSON.stringify(removeEmptyValues({ reviewerNotes }))
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to review application."));
  }

  return ((await response.json()) as { application: AdminApplicationSummary }).application;
}

export async function updateAdminUser(
  session: Session,
  userId: string,
  input: {
    verificationStatus?: string;
    creatorStatus?: string;
    globalRole?: string;
    status?: string;
  }
) {
  const response = await authenticatedFetch(session, `/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update user."));
  }

  return ((await response.json()) as { user: AdminUserSummary }).user;
}

export async function listAnnotationTemplates(session: Session) {
  const response = await authenticatedFetch(session, "/api/annotation-templates");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load annotation templates."));
  }

  return ((await response.json()) as { templates: AnnotationTemplateSummary[] }).templates;
}

export async function listBuiltInAnnotationTemplates(session: Session) {
  const response = await authenticatedFetch(session, "/api/annotation-templates/builtins");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load built-in annotation templates."));
  }

  return (await response.json()) as {
    groups: BuiltInAnnotationTemplateGroup[];
    templates: BuiltInAnnotationTemplateSummary[];
  };
}

export async function listAnnotationCategories(session: Session) {
  const response = await authenticatedFetch(session, "/api/annotation-templates/categories");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load annotation categories."));
  }

  return ((await response.json()) as { categories: AnnotationCategorySummary[] }).categories;
}

export async function createAnnotationCategory(
  session: Session,
  input: {
    description?: string;
    name: string;
    organizationId?: string | null;
  }
) {
  const response = await authenticatedFetch(session, "/api/annotation-templates/categories", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create annotation category."));
  }

  return ((await response.json()) as { category: AnnotationCategorySummary }).category;
}

export async function updateAnnotationCategory(
  session: Session,
  categoryId: string,
  input: {
    description?: string;
    name?: string;
  }
) {
  const response = await authenticatedFetch(
    session,
    `/api/annotation-templates/categories/${encodeURIComponent(categoryId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(removeEmptyValues(input))
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update annotation category."));
  }

  return ((await response.json()) as { category: AnnotationCategorySummary }).category;
}

export async function deleteAnnotationCategory(session: Session, categoryId: string) {
  const response = await authenticatedFetch(
    session,
    `/api/annotation-templates/categories/${encodeURIComponent(categoryId)}`,
    {
      method: "DELETE"
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete annotation category."));
  }

  return (await response.json()) as { deleted: boolean };
}

export async function createAnnotationTemplate(
  session: Session,
  input: {
    categoryId: string;
    configJson: Record<string, unknown>;
    dataType: string;
    description?: string;
    name: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/annotation-templates", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create annotation template."));
  }

  return ((await response.json()) as { template: AnnotationTemplateSummary }).template;
}

export async function updateAnnotationTemplate(
  session: Session,
  templateId: string,
  input: {
    categoryId?: string;
    configJson?: Record<string, unknown>;
    dataType?: string;
    description?: string;
    name?: string;
  }
) {
  const response = await authenticatedFetch(session, `/api/annotation-templates/${encodeURIComponent(templateId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update annotation template."));
  }

  return ((await response.json()) as { template: AnnotationTemplateSummary }).template;
}

export async function deleteAnnotationTemplate(session: Session, templateId: string) {
  const response = await authenticatedFetch(session, `/api/annotation-templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete annotation template."));
  }

  return (await response.json()) as { deleted: boolean };
}

export async function listOrganizations(session: Session) {
  const response = await authenticatedFetch(session, "/api/organizations");

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Unable to load organizations.");
  }

  return ((await response.json()) as { organizations: OrganizationSummary[] }).organizations;
}

export async function createOrganization(session: Session, input: CreateOrganizationInput) {
  const response = await authenticatedFetch(session, "/api/organizations", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Unable to create organization.");
  }

  return (await response.json()) as {
    organization: {
      id: string;
      name: string;
      slug: string;
      type: string;
      planTier: string;
    };
    workspace: {
      id: string;
      name: string;
      slug: string;
    };
  };
}

export async function getOrganization(session: Session, organizationId: string) {
  const response = await authenticatedFetch(session, `/api/organizations/${encodeURIComponent(organizationId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load organization."));
  }

  return ((await response.json()) as { organization: OrganizationDetail }).organization;
}

export async function joinOrganizationWithCode(session: Session, code: string) {
  const response = await authenticatedFetch(session, "/api/organizations/join-code", {
    method: "POST",
    body: JSON.stringify({ code })
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to join organization."));
  }

  return (await response.json()) as {
    membershipId: string;
    status: string;
    requiresApproval: boolean;
  };
}

export async function updateOrganization(session: Session, organizationId: string, input: UpdateOrganizationInput) {
  const response = await authenticatedFetch(session, `/api/organizations/${encodeURIComponent(organizationId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update organization."));
  }

  return ((await response.json()) as { organization: OrganizationDetail }).organization;
}

export async function deleteOrganization(session: Session, organizationId: string) {
  const response = await authenticatedFetch(session, `/api/organizations/${encodeURIComponent(organizationId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete organization."));
  }
}

export async function addOrganizationMember(session: Session, organizationId: string, input: AddMemberInput) {
  const response = await authenticatedFetch(session, `/api/organizations/${encodeURIComponent(organizationId)}/members`, {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to add member."));
  }

  return ((await response.json()) as { membership: MembershipSummary }).membership;
}

export async function updateOrganizationMember(
  session: Session,
  organizationId: string,
  membershipId: string,
  input: UpdateMemberInput
) {
  const response = await authenticatedFetch(
    session,
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(removeEmptyValues(input))
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update member."));
  }

  return ((await response.json()) as { membership: MembershipSummary }).membership;
}

export async function removeOrganizationMember(session: Session, organizationId: string, membershipId: string) {
  const response = await authenticatedFetch(
    session,
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`,
    {
      method: "DELETE"
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to remove member."));
  }
}

export async function listProjects(session: Session) {
  const response = await authenticatedFetch(session, "/api/projects");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load projects."));
  }

  return ((await response.json()) as { projects: ProjectSummary[] }).projects;
}

export async function getProject(session: Session, projectId: string) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function createProject(session: Session, input: CreateProjectInput) {
  const response = await authenticatedFetch(session, "/api/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function updateProject(session: Session, projectId: string, input: UpdateProjectInput) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function archiveProject(session: Session, projectId: string) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}/archive`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to archive project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function restoreProject(session: Session, projectId: string) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}/restore`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to restore project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function deleteProject(session: Session, projectId: string) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete project."));
  }

  return (await response.json()) as { deleted: boolean };
}

export async function listDatasets(session: Session, projectId?: string) {
  const params = new URLSearchParams();

  if (projectId) {
    params.set("projectId", projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/datasets${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load datasets."));
  }

  return ((await response.json()) as { datasets: DatasetSummary[] }).datasets;
}

export async function getDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function createDataset(session: Session, input: CreateDatasetInput) {
  const response = await authenticatedFetch(session, "/api/datasets", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function updateDataset(session: Session, datasetId: string, input: UpdateDatasetInput) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function listDatasetVersions(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}/versions`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load dataset versions."));
  }

  return ((await response.json()) as { versions: DatasetVersionSummary[] }).versions;
}

export async function rollbackDatasetVersion(session: Session, datasetId: string, version: number) {
  const response = await authenticatedFetch(
    session,
    `/api/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(String(version))}/rollback`,
    {
      method: "POST"
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to rollback dataset version."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function archiveDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}/archive`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to archive dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function restoreDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}/restore`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to restore dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function deleteDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete dataset."));
  }

  return (await response.json()) as {
    deleted: boolean;
    deletedAssetCount: number;
    deletedTaskCount: number;
  };
}

export async function listAssets(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/assets${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load assets."));
  }

  return ((await response.json()) as { assets: AssetSummary[] }).assets;
}

export async function createAsset(session: Session, input: CreateAssetInput) {
  const response = await authenticatedFetch(session, "/api/assets", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to register asset."));
  }

  return ((await response.json()) as { asset: AssetSummary }).asset;
}

export async function createAssetUploadUrl(session: Session, input: AssetUploadRequest) {
  const response = await authenticatedFetch(session, "/api/assets/upload-url", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create R2 upload URL."));
  }

  return (await response.json()) as AssetUploadUrl;
}

export async function startAssetMultipartUpload(session: Session, input: AssetUploadRequest) {
  const response = await authenticatedFetch(session, "/api/assets/multipart/start", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to start multipart upload."));
  }

  return (await response.json()) as AssetMultipartUpload;
}

export async function refreshAssetMultipartPartUrl(
  session: Session,
  input: {
    bucket: string;
    datasetId: string;
    objectKey: string;
    partNumber: number;
    uploadId: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/assets/multipart/part-url", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to refresh multipart upload URL."));
  }

  return (await response.json()) as MultipartUploadPartUrl;
}

export async function completeAssetMultipartUpload(
  session: Session,
  input: {
    bucket: string;
    datasetId: string;
    objectKey: string;
    parts: CompletedMultipartPart[];
    uploadId: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/assets/multipart/complete", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to complete multipart upload."));
  }

  return (await response.json()) as { bucket: string; objectKey: string };
}

export async function abortAssetMultipartUpload(
  session: Session,
  input: {
    bucket: string;
    datasetId: string;
    objectKey: string;
    uploadId: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/assets/multipart/abort", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to abort multipart upload."));
  }

  return (await response.json()) as { ok: true };
}

export async function getAssetAccessUrl(session: Session, assetId: string) {
  const response = await authenticatedFetch(session, `/api/assets/${encodeURIComponent(assetId)}/access-url`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create asset access URL."));
  }

  return (await response.json()) as AssetAccessUrl;
}

export async function listExportJobs(session: Session, input: { datasetId?: string; projectId?: string }) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/exports${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load exports."));
  }

  return ((await response.json()) as { exports: ExportJobSummary[] }).exports;
}

export async function createExportJob(session: Session, input: { datasetId?: string; format?: ExportFormat; includeSourceFiles?: boolean; projectId?: string }) {
  const response = await authenticatedFetch(session, "/api/exports", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues({ ...input, format: input.format ?? "JSON" }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create export."));
  }

  return ((await response.json()) as { export: ExportJobSummary }).export;
}

export async function getExportDownloadUrl(session: Session, exportId: string) {
  const response = await authenticatedFetch(session, `/api/exports/${encodeURIComponent(exportId)}/download-url`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create export download URL."));
  }

  return (await response.json()) as ExportDownloadUrl;
}

export async function deleteAssets(
  session: Session,
  input: { assetIds?: string[]; datasetId?: string; folderPrefix?: string }
) {
  const response = await authenticatedFetch(session, "/api/assets/delete", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete assets."));
  }

  return (await response.json()) as DeleteAssetsResult;
}

export async function listTasks(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load tasks."));
  }

  return ((await response.json()) as { tasks: TaskSummary[] }).tasks;
}

export async function listTaskPage(
  session: Session,
  input: { datasetId?: string; page?: number; pageSize?: number; projectId?: string; queue?: "review" | "work" } & TaskQueueFilters = {}
) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.page) {
    params.set("page", String(input.page));
  }

  if (input.pageSize) {
    params.set("pageSize", String(input.pageSize));
  }

  if (input.queue === "review") {
    params.set("queue", "review");
  }

  appendTaskQueueFilters(params, input);

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load tasks."));
  }

  return (await response.json()) as TaskPageResult;
}

export async function listTaskFolders(session: Session, input: { projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/folders${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task folders."));
  }

  return (await response.json()) as TaskFoldersResult;
}

export async function getTaskStats(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/stats${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task stats."));
  }

  return ((await response.json()) as { stats: TaskStatsSummary }).stats;
}

export async function getTask(session: Session, taskId: string) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task."));
  }

  return (await response.json()) as TaskDetailResult;
}

export async function addTaskComment(session: Session, taskId: string, input: { annotationId?: string | null; body: string }) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to add comment."));
  }

  return ((await response.json()) as { comment: CommentSummary }).comment;
}

export async function reviewTask(
  session: Session,
  taskId: string,
  input: { decision: "approve" | "reject"; feedback?: string }
) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/review`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to review task."));
  }

  return (await response.json()) as ReviewTaskResult;
}

export async function getNextTask(
  session: Session,
  taskId: string,
  input: { datasetId?: string; projectId?: string; queue?: "review" | "work" } & TaskQueueFilters = {}
) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.queue === "review") {
    params.set("queue", "review");
  }

  appendTaskQueueFilters(params, input);

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/next${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load the next task."));
  }

  return (await response.json()) as NextTaskResult;
}

export async function saveTaskAnnotation(session: Session, taskId: string, input: SaveAnnotationInput) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/annotation`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save annotation."));
  }

  return (await response.json()) as TaskDetailResult;
}

export async function submitTaskAnnotation(session: Session, taskId: string, input: SaveAnnotationInput) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/annotation/submit`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to submit annotation."));
  }

  return (await response.json()) as TaskDetailResult;
}

export async function generateTasksFromDataset(session: Session, datasetId: string, input: { quantity?: number } & TaskWorkflowInput = {}) {
  const response = await authenticatedFetch(session, "/api/tasks/generate-from-dataset", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues({ ...input, datasetId }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to generate tasks."));
  }

  return (await response.json()) as GenerateTasksResult;
}

export async function applyDatasetTaskWorkflow(session: Session, datasetId: string, input: TaskWorkflowInput) {
  const response = await authenticatedFetch(session, "/api/tasks/dataset-workflow", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues({ ...input, datasetId }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update dataset task workflow."));
  }

  return (await response.json()) as DatasetWorkflowResult;
}

export async function assignDatasetToSelf(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, "/api/tasks/assign-dataset-to-self", {
    method: "POST",
    body: JSON.stringify({ datasetId })
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to assign dataset tasks."));
  }

  return (await response.json()) as DatasetAssignmentResult;
}

export async function listTaskParticipants(session: Session, projectId: string) {
  const params = new URLSearchParams({ projectId });
  const response = await authenticatedFetch(session, `/api/tasks/participants?${params.toString()}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task participants."));
  }

  return ((await response.json()) as { participants: TaskParticipantSummary[] }).participants;
}

export async function updateTaskWorkflow(session: Session, taskId: string, input: TaskWorkflowInput) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/workflow`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update task workflow."));
  }

  return ((await response.json()) as { task: TaskSummary }).task;
}

export async function assignTaskToSelf(session: Session, taskId: string) {
  return updateTask(session, taskId, "assign-self");
}

export async function startTask(session: Session, taskId: string) {
  return updateTask(session, taskId, "start");
}

export async function submitTask(session: Session, taskId: string) {
  return updateTask(session, taskId, "submit");
}

export async function uploadFileToSignedUrl(
  file: File,
  upload: AssetUploadUrl["upload"],
  onProgress?: (progress: { loaded: number; percent: number; total: number }) => void
) {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open(upload.method, upload.uploadUrl);

    for (const [header, value] of Object.entries(upload.headers)) {
      request.setRequestHeader(header, value);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress?.({
        loaded: event.loaded,
        percent: Math.round((event.loaded / event.total) * 100),
        total: event.total
      });
    };

    request.onerror = () => {
      reject(
        new Error(
          "R2 upload could not reach Cloudflare. Check the bucket CORS policy for http://localhost:5173, confirm R2_ENDPOINT uses the r2.cloudflarestorage.com endpoint, then run pnpm check:r2-cors."
        )
      );
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.({
          loaded: file.size,
          percent: 100,
          total: file.size
        });
        resolve();
        return;
      }

      reject(
        new Error(
          `R2 upload failed with status ${request.status}. Check the bucket CORS settings and R2 credentials, then run pnpm check:r2-cors.`
        )
      );
    };

    request.send(file);
  });
}

export const resumableUploadThresholdBytes = 64 * 1024 * 1024;

interface ResumableUploadRecord {
  asset: CreateAssetInput;
  completedParts: CompletedMultipartPart[];
  fileLastModified: number;
  fileName: string;
  fileSize: number;
  upload: AssetMultipartUpload["upload"];
  updatedAt: number;
}

export async function uploadFileWithResumableMultipart(
  session: Session,
  file: File,
  request: AssetUploadRequest,
  onProgress?: (progress: { loaded: number; percent: number; total: number }) => void
) {
  const storageKey = getResumableUploadStorageKey(request.datasetId, request.objectKey ?? file.name, file);
  const existingRecord = readResumableUploadRecord(storageKey, file);
  const record = existingRecord ?? await createResumableUploadRecord(session, request, storageKey, file);
  const completedParts = new Map(record.completedParts.map((part) => [part.partNumber, part]));
  const partUrls = new Map(record.upload.parts.map((part) => [part.partNumber, part]));
  let completedBytes = getCompletedMultipartBytes(completedParts, record.upload.partSize, file.size);

  onProgress?.({
    loaded: completedBytes,
    percent: Math.round((completedBytes / file.size) * 100),
    total: file.size
  });

  for (let partNumber = 1; partNumber <= record.upload.partCount; partNumber += 1) {
    if (completedParts.has(partNumber)) {
      continue;
    }

    const start = (partNumber - 1) * record.upload.partSize;
    const end = Math.min(file.size, start + record.upload.partSize);
    const blob = file.slice(start, end);
    let partUrl = partUrls.get(partNumber) ?? await refreshAssetMultipartPartUrl(session, {
      bucket: record.upload.bucket,
      datasetId: request.datasetId,
      objectKey: record.upload.objectKey,
      partNumber,
      uploadId: record.upload.uploadId
    });
    let uploadedPart: CompletedMultipartPart | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const etag = await uploadMultipartPart(blob, partUrl, (loaded) => {
          onProgress?.({
            loaded: completedBytes + loaded,
            percent: Math.round(((completedBytes + loaded) / file.size) * 100),
            total: file.size
          });
        });
        uploadedPart = { etag, partNumber };
        break;
      } catch (error) {
        if (attempt >= 2) {
          throw error;
        }

        partUrl = await refreshAssetMultipartPartUrl(session, {
          bucket: record.upload.bucket,
          datasetId: request.datasetId,
          objectKey: record.upload.objectKey,
          partNumber,
          uploadId: record.upload.uploadId
        });
      }
    }

    if (!uploadedPart) {
      throw new Error(`Part ${partNumber} did not finish uploading.`);
    }

    completedParts.set(partNumber, uploadedPart);
    completedBytes += blob.size;
    writeResumableUploadRecord(storageKey, {
      ...record,
      completedParts: Array.from(completedParts.values()).sort((first, second) => first.partNumber - second.partNumber),
      updatedAt: Date.now()
    });
  }

  await completeAssetMultipartUpload(session, {
    bucket: record.upload.bucket,
    datasetId: request.datasetId,
    objectKey: record.upload.objectKey,
    parts: Array.from(completedParts.values()).sort((first, second) => first.partNumber - second.partNumber),
    uploadId: record.upload.uploadId
  });
  clearResumableUploadRecord(storageKey);
  onProgress?.({
    loaded: file.size,
    percent: 100,
    total: file.size
  });

  return record.asset;
}

async function createResumableUploadRecord(
  session: Session,
  request: AssetUploadRequest,
  storageKey: string,
  file: File
): Promise<ResumableUploadRecord> {
  const multipart = await startAssetMultipartUpload(session, request);
  const record: ResumableUploadRecord = {
    asset: multipart.asset,
    completedParts: [],
    fileLastModified: file.lastModified,
    fileName: file.name,
    fileSize: file.size,
    upload: multipart.upload,
    updatedAt: Date.now()
  };

  writeResumableUploadRecord(storageKey, record);
  return record;
}

function uploadMultipartPart(
  blob: Blob,
  part: MultipartUploadPartUrl,
  onProgress?: (loaded: number) => void
) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open(part.method, part.uploadUrl);

    for (const [header, value] of Object.entries(part.headers)) {
      request.setRequestHeader(header, value);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded);
      }
    };

    request.onerror = () => {
      reject(new Error("R2 multipart upload could not reach Cloudflare. Check the bucket CORS policy and network connection."));
    };

    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`R2 multipart upload failed with status ${request.status}.`));
        return;
      }

      const etag = request.getResponseHeader("ETag");

      if (!etag) {
        reject(new Error("R2 multipart upload did not expose the ETag header. Add ETag to the bucket CORS ExposeHeaders setting."));
        return;
      }

      resolve(etag);
    };

    request.send(blob);
  });
}

function getCompletedMultipartBytes(completedParts: Map<number, CompletedMultipartPart>, partSize: number, fileSize: number) {
  let total = 0;

  for (const partNumber of completedParts.keys()) {
    const start = (partNumber - 1) * partSize;
    total += Math.max(0, Math.min(fileSize - start, partSize));
  }

  return total;
}

function getResumableUploadStorageKey(datasetId: string, objectKey: string, file: File) {
  return `goxai-resumable-upload:${datasetId}:${objectKey}:${file.name}:${file.size}:${file.lastModified}`;
}

function readResumableUploadRecord(storageKey: string, file: File): ResumableUploadRecord | null {
  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return null;
    }

    const record = JSON.parse(raw) as ResumableUploadRecord;

    if (record.fileName !== file.name || record.fileSize !== file.size || record.fileLastModified !== file.lastModified) {
      return null;
    }

    return record;
  } catch {
    return null;
  }
}

function writeResumableUploadRecord(storageKey: string, record: ResumableUploadRecord) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(record));
  } catch {
    // Best effort only. Uploads still work without local resumability.
  }
}

function clearResumableUploadRecord(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Best effort only.
  }
}

export async function logClientEvent(session: Session, input: ClientLogInput) {
  const response = await authenticatedFetch(session, "/api/logs/client", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save client log."));
  }
}

function authenticatedFetch(session: Session, path: string, init: RequestInit = {}) {
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}

function appendTaskQueueFilters(params: URLSearchParams, input: TaskQueueFilters) {
  if (input.assignment && input.assignment !== "all") {
    params.set("assignment", input.assignment);
  }

  if (input.due && input.due !== "any") {
    params.set("due", input.due);
  }

  if (typeof input.minPriority === "number" && Number.isFinite(input.minPriority)) {
    params.set("minPriority", String(input.minPriority));
  }

  if (input.search?.trim()) {
    params.set("search", input.search.trim());
  }

  if (input.status?.trim()) {
    params.set("status", input.status.trim());
  }
}

async function updateTask(session: Session, taskId: string, action: "assign-self" | "start" | "submit") {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update task."));
  }

  return ((await response.json()) as { task: TaskSummary }).task;
}

async function getApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  return payload.error ?? fallback;
}

function removeEmptyValues<T extends object>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== "")
  );
}

export type { SupabaseClient };
