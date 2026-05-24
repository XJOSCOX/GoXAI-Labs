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

export interface AssetAccessUrl {
  accessUrl: string;
  expiresInSeconds: number;
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

export interface TaskDetailResult {
  annotation: AnnotationSummary | null;
  task: TaskSummary;
}

export interface SaveAnnotationInput {
  leadTimeSeconds?: number;
  regions: {
    geometry:
      | {
          height: number;
          width: number;
          x: number;
          y: number;
        }
      | {
          points: {
            x: number;
            y: number;
          }[];
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

export async function getAssetAccessUrl(session: Session, assetId: string) {
  const response = await authenticatedFetch(session, `/api/assets/${encodeURIComponent(assetId)}/access-url`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create asset access URL."));
  }

  return (await response.json()) as AssetAccessUrl;
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

export async function getTask(session: Session, taskId: string) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task."));
  }

  return (await response.json()) as TaskDetailResult;
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

export async function generateTasksFromDataset(session: Session, datasetId: string, input: { quantity?: number } = {}) {
  const response = await authenticatedFetch(session, "/api/tasks/generate-from-dataset", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues({ datasetId, quantity: input.quantity }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to generate tasks."));
  }

  return (await response.json()) as GenerateTasksResult;
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
