import { MembershipRole } from "@goxai/database";

export interface RoleMembership {
  role: MembershipRole;
}

type OptionalMembership = RoleMembership | null | undefined;
type CapabilityCheck = (membership: RoleMembership) => boolean;

const organizationManagerRoles = [MembershipRole.OWNER, MembershipRole.ADMIN] as const;
const projectManagerRoles = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER] as const;
const taskWorkerRoles = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.MANAGER,
  MembershipRole.REVIEWER,
  MembershipRole.ANNOTATOR
] as const;
const taskReviewerRoles = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.MANAGER,
  MembershipRole.REVIEWER
] as const;

export const roleCapabilities = {
  OWNER: [
    "Full organization control",
    "Manage organization settings and billing plan",
    "Add, update, and remove members",
    "Grant or remove owner role",
    "Create organization projects",
    "Manage owned project settings, datasets, assets, and tasks",
    "Upload/register assets",
    "Generate and work tasks"
  ],
  ADMIN: [
    "Manage organization settings",
    "Add, update, and remove non-owner members",
    "Manage assigned project settings, datasets, assets, and tasks",
    "Upload/register assets",
    "Generate and work tasks"
  ],
  MANAGER: [
    "Manage assigned project operations",
    "Upload/register assets when granted project access",
    "Generate tasks",
    "Assign and work tasks"
  ],
  REVIEWER: [
    "Read projects, datasets, assets, and tasks",
    "Assign and work tasks",
    "Prepared for review and QA flows"
  ],
  ANNOTATOR: [
    "Read projects, datasets, assets, and tasks",
    "Assign and work tasks"
  ],
  VIEWER: [
    "Read-only access to projects, datasets, assets, and tasks"
  ]
} satisfies Record<MembershipRole, string[]>;

export function canUpdateOrganization(membership: RoleMembership) {
  return hasRole(membership, organizationManagerRoles);
}

export function canDeleteOrganization(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER]);
}

export function canManageMembers(membership: RoleMembership) {
  return hasRole(membership, organizationManagerRoles);
}

export function canGrantOwnerRole(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER]);
}

export function canManageProjects(membership: RoleMembership) {
  return hasRole(membership, projectManagerRoles);
}

export function canCreateOrganizationProjects(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER]);
}

export function canManageProjectScope(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER, MembershipRole.ADMIN]);
}

export function canManageDatasets(membership: RoleMembership) {
  return hasRole(membership, projectManagerRoles);
}

export function canManageAssets(membership: RoleMembership) {
  return hasRole(membership, projectManagerRoles);
}

export function canGenerateTasks(membership: RoleMembership) {
  return hasRole(membership, projectManagerRoles);
}

export function canWorkTasks(membership: RoleMembership) {
  return hasRole(membership, taskWorkerRoles);
}

export function canReviewTasks(membership: RoleMembership) {
  return hasRole(membership, taskReviewerRoles);
}

export function getEffectiveMembershipForCapability(
  organizationMembership: OptionalMembership,
  projectMembership: OptionalMembership,
  capability: CapabilityCheck
) {
  return organizationMembership && capability(organizationMembership)
    ? organizationMembership
    : projectMembership ?? organizationMembership ?? undefined;
}

export function canManageDatasetScope(input: {
  isProjectCreator?: boolean;
  organizationMembership?: OptionalMembership;
  projectMembership?: OptionalMembership;
}) {
  return canUseScopedCapability(input, canManageDatasets);
}

export function canManageAssetScope(input: {
  isProjectCreator?: boolean;
  organizationMembership?: OptionalMembership;
  projectMembership?: OptionalMembership;
}) {
  return canUseScopedCapability(input, canManageAssets);
}

export function canExportScope(input: {
  isProjectCreator?: boolean;
  organizationMembership?: OptionalMembership;
  projectMembership?: OptionalMembership;
}) {
  return canUseScopedCapability(input, canGenerateTasks);
}

export function canGenerateTaskScope(input: {
  isProjectCreator?: boolean;
  organizationMembership?: OptionalMembership;
  projectMembership?: OptionalMembership;
}) {
  return canUseScopedCapability(input, canGenerateTasks);
}

function canUseScopedCapability(
  input: {
    isProjectCreator?: boolean;
    organizationMembership?: OptionalMembership;
    projectMembership?: OptionalMembership;
  },
  capability: CapabilityCheck
) {
  return Boolean(
    input.isProjectCreator ||
      (input.organizationMembership && capability(input.organizationMembership)) ||
      (input.projectMembership && capability(input.projectMembership))
  );
}

function hasRole(membership: RoleMembership, roles: readonly MembershipRole[]) {
  return roles.includes(membership.role);
}
