import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { AddMemberInput, CreateOrganizationInput, MembershipSummary, OrganizationDetail, OrganizationSummary, UpdateMemberInput, UpdateOrganizationInput } from "./types";
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
