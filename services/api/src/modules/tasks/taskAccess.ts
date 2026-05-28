import {
  getPrismaClient,
  ProjectAccessMode,
  ProjectStatus,
  TaskStatus,
  type Prisma
} from "@goxai/database";
import { canGenerateTasks, canReviewTasks, canWorkTasks } from "../../shared/permissions.js";

async function getActiveMemberships(userId: string) {
  const prisma = getPrismaClient();
  return prisma.membership.findMany({
    where: {
      userId,
      status: "ACTIVE"
    },
    select: {
      organizationId: true,
      role: true
    }
  });
}

export async function getEffectiveProjectMembership(userId: string, projectId: string, organizationId: string) {
  const prisma = getPrismaClient();
  const [organizationMembership, projectMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        organizationId,
        status: "ACTIVE",
        userId
      },
      select: {
        role: true
      }
    }),
    prisma.projectMembership.findFirst({
      where: {
        projectId,
        status: "ACTIVE",
        userId
      },
      select: {
        role: true
      }
    })
  ]);

  return organizationMembership ?? projectMembership;
}

export async function userCanWorkProjectTasks(userId: string, projectId: string, organizationId: string) {
  const membership = await getEffectiveProjectMembership(userId, projectId, organizationId);
  return Boolean(membership && canWorkTasks(membership));
}

export async function userCanReviewProjectTasks(userId: string, projectId: string, organizationId: string) {
  const membership = await getEffectiveProjectMembership(userId, projectId, organizationId);
  return Boolean(membership && canReviewTasks(membership));
}

export async function getTaskAccessScope(userId: string) {
  const prisma = getPrismaClient();
  const [memberships, projectMemberships] = await Promise.all([
    getActiveMemberships(userId),
    prisma.projectMembership.findMany({
      where: {
        userId,
        status: "ACTIVE"
      },
      select: {
        projectId: true,
        role: true
      }
    })
  ]);
  const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
  const projectIds = [...new Set(projectMemberships.map((membership) => membership.projectId))];

  return {
    manageableOrganizationIds: memberships.filter(canGenerateTasks).map((membership) => membership.organizationId),
    manageableProjectIds: projectMemberships.filter(canGenerateTasks).map((membership) => membership.projectId),
    membershipByOrganizationId: new Map(memberships.map((membership) => [membership.organizationId, membership])),
    membershipByProjectId: new Map(projectMemberships.map((membership) => [membership.projectId, membership])),
    organizationIds,
    projectIds,
    reviewOrganizationIds: memberships.filter(canReviewTasks).map((membership) => membership.organizationId),
    reviewProjectIds: projectMemberships.filter(canReviewTasks).map((membership) => membership.projectId)
  };
}

type TaskAccessScope = Awaited<ReturnType<typeof getTaskAccessScope>>;

export function buildAccessibleProjectConditions(organizationIds: string[], projectIds: string[]): Prisma.ProjectWhereInput[] {
  return [
    ...(organizationIds.length > 0
      ? [
          {
            organizationId: {
              in: organizationIds
            }
          }
        ]
      : []),
    ...(projectIds.length > 0
      ? [
          {
            id: {
              in: projectIds
            }
          }
        ]
      : []),
    {
      accessMode: ProjectAccessMode.PUBLIC,
      status: ProjectStatus.ACTIVE
    }
  ];
}

export function buildVisibleTaskWhere(scope: TaskAccessScope, filters: { datasetId?: string; projectId?: string } = {}): Prisma.TaskWhereInput {
  return {
    ...(filters.datasetId ? { datasetId: filters.datasetId } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    OR: [
      ...(scope.manageableOrganizationIds.length > 0
        ? [
            {
              project: {
                organizationId: {
                  in: scope.manageableOrganizationIds
                }
              }
            }
          ]
        : []),
      ...(scope.manageableProjectIds.length > 0
        ? [
            {
              projectId: {
                in: scope.manageableProjectIds
              }
            }
          ]
        : []),
      {
        project: {
          OR: buildAccessibleProjectConditions(scope.organizationIds, scope.projectIds),
          status: ProjectStatus.ACTIVE
        },
        status: {
          not: TaskStatus.ARCHIVED
        }
      }
    ]
  };
}

export function buildTaskCreditWhere(scope: TaskAccessScope, filters: { datasetId?: string; projectId?: string } = {}): Prisma.TaskCreditEventWhereInput {
  return {
    ...(filters.datasetId ? { datasetId: filters.datasetId } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    OR: [
      ...(scope.manageableOrganizationIds.length > 0
        ? [
            {
              organizationId: {
                in: scope.manageableOrganizationIds
              }
            }
          ]
        : []),
      ...(scope.manageableProjectIds.length > 0
        ? [
            {
              projectId: {
                in: scope.manageableProjectIds
              }
            }
          ]
        : []),
      ...(scope.organizationIds.length > 0
        ? [
            {
              organizationId: {
                in: scope.organizationIds
              },
              project: {
                status: ProjectStatus.ACTIVE
              }
            }
          ]
        : []),
      ...(scope.projectIds.length > 0
        ? [
            {
              projectId: {
                in: scope.projectIds
              },
              project: {
                status: ProjectStatus.ACTIVE
              }
            }
          ]
        : []),
      {
        project: {
          accessMode: ProjectAccessMode.PUBLIC,
          status: ProjectStatus.ACTIVE
        }
      }
    ]
  };
}

export function buildReviewTaskWhere(scope: TaskAccessScope, filters: { datasetId?: string; projectId?: string } = {}): Prisma.TaskWhereInput {
  if (scope.reviewOrganizationIds.length === 0 && scope.reviewProjectIds.length === 0) {
    return {
      id: "__no_review_access__"
    };
  }

  return {
    ...(filters.datasetId ? { datasetId: filters.datasetId } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    status: {
      in: [TaskStatus.SUBMITTED, TaskStatus.REVIEWING]
    },
    OR: [
      ...(scope.reviewOrganizationIds.length > 0
        ? [
            {
              project: {
                organizationId: {
                  in: scope.reviewOrganizationIds
                }
              }
            }
          ]
        : []),
      ...(scope.reviewProjectIds.length > 0
        ? [
            {
              projectId: {
                in: scope.reviewProjectIds
              }
            }
          ]
        : [])
    ]
  };
}
