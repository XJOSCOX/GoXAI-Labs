import { MembershipRole } from "@goxai/database";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canCreateOrganizationProjects,
  canDeleteOrganization,
  canGenerateTasks,
  canExportScope,
  canManageAssetScope,
  canGrantOwnerRole,
  canManageAssets,
  canManageDatasetScope,
  canManageDatasets,
  canManageMembers,
  canManageProjectScope,
  canManageProjects,
  canReviewTasks,
  canUpdateOrganization,
  canWorkTasks,
  getEffectiveMembershipForCapability
} from "./permissions.js";

const checks = {
  canCreateOrganizationProjects,
  canDeleteOrganization,
  canGenerateTasks,
  canGrantOwnerRole,
  canManageAssets,
  canManageDatasets,
  canManageMembers,
  canManageProjectScope,
  canManageProjects,
  canReviewTasks,
  canUpdateOrganization,
  canWorkTasks
};

type PermissionName = keyof typeof checks;

describe("role permission matrix", () => {
  it("keeps owner as the only full-control role", () => {
    assertRole(MembershipRole.OWNER, [
      "canCreateOrganizationProjects",
      "canDeleteOrganization",
      "canGenerateTasks",
      "canGrantOwnerRole",
      "canManageAssets",
      "canManageDatasets",
      "canManageMembers",
      "canManageProjectScope",
      "canManageProjects",
      "canReviewTasks",
      "canUpdateOrganization",
      "canWorkTasks"
    ]);
  });

  it("keeps admins powerful without owner-only actions", () => {
    assertRole(MembershipRole.ADMIN, [
      "canGenerateTasks",
      "canManageAssets",
      "canManageDatasets",
      "canManageMembers",
      "canManageProjectScope",
      "canManageProjects",
      "canReviewTasks",
      "canUpdateOrganization",
      "canWorkTasks"
    ]);
  });

  it("keeps managers focused on assigned project operations", () => {
    assertRole(MembershipRole.MANAGER, [
      "canGenerateTasks",
      "canManageAssets",
      "canManageDatasets",
      "canManageProjects",
      "canReviewTasks",
      "canWorkTasks"
    ]);
  });

  it("keeps reviewers in review and task work only", () => {
    assertRole(MembershipRole.REVIEWER, ["canReviewTasks", "canWorkTasks"]);
  });

  it("keeps annotators in task work only", () => {
    assertRole(MembershipRole.ANNOTATOR, ["canWorkTasks"]);
  });

  it("keeps viewers read-only", () => {
    assertRole(MembershipRole.VIEWER, []);
  });
});

describe("scoped route permission decisions", () => {
  it("lets project creators manage datasets, assets, and exports without another membership", () => {
    assert.equal(canManageDatasetScope({ isProjectCreator: true }), true);
    assert.equal(canManageAssetScope({ isProjectCreator: true }), true);
    assert.equal(canExportScope({ isProjectCreator: true }), true);
  });

  it("lets organization managers control project datasets even without project membership", () => {
    const organizationMembership = { role: MembershipRole.MANAGER };

    assert.equal(canManageDatasetScope({ organizationMembership }), true);
    assert.equal(canManageAssetScope({ organizationMembership }), true);
    assert.equal(canExportScope({ organizationMembership }), true);
  });

  it("falls through from a weak organization role to a stronger project role", () => {
    const effective = getEffectiveMembershipForCapability(
      { role: MembershipRole.ANNOTATOR },
      { role: MembershipRole.MANAGER },
      canManageDatasets
    );

    assert.deepEqual(effective, { role: MembershipRole.MANAGER });
    assert.equal(
      canManageDatasetScope({
        organizationMembership: { role: MembershipRole.ANNOTATOR },
        projectMembership: { role: MembershipRole.MANAGER }
      }),
      true
    );
  });

  it("blocks annotators and reviewers from management/export actions", () => {
    for (const role of [MembershipRole.ANNOTATOR, MembershipRole.REVIEWER]) {
      assert.equal(canManageDatasetScope({ organizationMembership: { role } }), false);
      assert.equal(canManageAssetScope({ projectMembership: { role } }), false);
      assert.equal(canExportScope({ organizationMembership: { role } }), false);
    }
  });
});

function assertRole(role: MembershipRole, expectedEnabled: PermissionName[]) {
  const enabled = Object.entries(checks)
    .filter(([, check]) => check({ role }))
    .map(([name]) => name)
    .sort();

  assert.deepEqual(enabled, expectedEnabled.sort());
}
