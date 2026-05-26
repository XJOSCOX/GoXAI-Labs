import { MembershipRole } from "@goxai/database";

export interface RoleMembership {
  role: MembershipRole;
}

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
  return hasRole(membership, [MembershipRole.OWNER, MembershipRole.ADMIN]);
}

export function canDeleteOrganization(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER]);
}

export function canManageMembers(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER, MembershipRole.ADMIN]);
}

export function canGrantOwnerRole(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER]);
}

export function canManageProjects(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER]);
}

export function canCreateOrganizationProjects(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER]);
}

export function canManageProjectScope(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER, MembershipRole.ADMIN]);
}

export function canManageDatasets(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER]);
}

export function canManageAssets(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER]);
}

export function canGenerateTasks(membership: RoleMembership) {
  return hasRole(membership, [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER]);
}

export function canWorkTasks(membership: RoleMembership) {
  return hasRole(membership, [
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MANAGER,
    MembershipRole.REVIEWER,
    MembershipRole.ANNOTATOR
  ]);
}

export function canReviewTasks(membership: RoleMembership) {
  return hasRole(membership, [
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MANAGER,
    MembershipRole.REVIEWER
  ]);
}

function hasRole(membership: RoleMembership, roles: MembershipRole[]) {
  return roles.includes(membership.role);
}
