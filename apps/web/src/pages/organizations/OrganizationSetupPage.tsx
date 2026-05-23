import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Building2, Save, ShieldCheck, UserCheck, UserRoundPlus, X } from "lucide-react";
import {
  addOrganizationMember,
  createOrganization,
  deleteOrganization,
  joinOrganizationWithCode,
  removeOrganizationMember,
  updateOrganization,
  updateOrganizationMember,
  type MembershipSummary,
  type OrganizationDetail
} from "../../api";
import { getFormValue, useAuth } from "../../auth";
import { memberRoles, planOptions, rolePrivileges } from "../../constants/options";
import { useFormDraft, useOrganization, useOrganizations } from "../../hooks/useResources";
import { formatDate, formatEnum } from "../../utils/format";

export function OrganizationSetupPage() {
  const { dbUser, session } = useAuth();
  const navigate = useNavigate();
  const { organizationId = "" } = useParams();
  const { error, loading, organizations, reload, setError } = useOrganizations(session);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const canCreateOrganizations = dbUser?.globalRole === "SUPER_ADMIN" || dbUser?.creatorStatus === "APPROVED";
  const {
    error: organizationDetailError,
    loading: organizationDetailLoading,
    organization,
    reload: reloadOrganization,
    setError: setOrganizationDetailError
  } = useOrganization(session, organizationId);

  async function handleJoinByCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const code = getFormValue(event, "code");
    setError(null);
    setJoinMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    setJoining(true);

    try {
      const result = await joinOrganizationWithCode(session, code);
      formElement.reset();
      setJoinMessage(
        result.requiresApproval
          ? "Join request sent. An organization owner or admin needs to approve your access."
          : "Organization joined. Your access is active."
      );
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to join organization.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <section className="page-stack organization-page">
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <section className="panel empty-state compact-empty">
          <Building2 size={28} />
          <strong>Loading organizations</strong>
          <span>Preparing your workspace directory.</span>
        </section>
      ) : organizations.length > 0 && !organizationId ? (
        <>
          <section className="panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Existing organizations</p>
                <h2>{organizations.length} organization{organizations.length === 1 ? "" : "s"}</h2>
              </div>
              <div className="section-actions">
                <span className="muted-copy">Select one to manage settings and members.</span>
                {canCreateOrganizations && (
                  <button className="primary-button" type="button" onClick={() => setShowCreateModal(true)}>
                    <Building2 size={18} />
                    New organization
                  </button>
                )}
              </div>
            </div>
            <div className="org-card-grid">
              {organizations.map((organization) => (
                <Link
                  className="org-summary-card"
                  key={organization.id}
                  to={`/organization/${organization.id}`}
                >
                  <span className="org-card-head">
                    <span>
                      <strong>{organization.name}</strong>
                      <small>{organization.description || organization.workspace?.name || "Organization wide"}</small>
                    </span>
                    <span className="status-pill compact">{formatEnum(organization.role)}</span>
                  </span>
                  <span className="org-card-badges">
                    <span>{formatEnum(organization.type)}</span>
                    <span>{formatEnum(organization.planTier)}</span>
                    <span>{formatEnum(organization.accessMode)}</span>
                    <span>
                      {organization.joinCodeEnabled
                        ? organization.joinRequiresApproval
                          ? "Code approval"
                          : "Join code on"
                        : "Invite managed"}
                    </span>
                  </span>
                  <span className="org-card-stats">
                    <span>
                      <strong>{organization.counts.owners}</strong>
                      <small>Owners</small>
                    </span>
                    <span>
                      <strong>{organization.counts.members}</strong>
                      <small>Members</small>
                    </span>
                    <span>
                      <strong>{organization.counts.projects}</strong>
                      <small>Projects</small>
                    </span>
                    <span>
                      <strong>{organization.counts.datasets}</strong>
                      <small>Datasets</small>
                    </span>
                  </span>
                  <span className="org-card-meta">
                    <span>
                      <small>Org slug</small>
                      <strong>{organization.slug}</strong>
                    </span>
                    <span>
                      <small>Workspace</small>
                      <strong>{organization.workspace?.slug ?? "wide"}</strong>
                    </span>
                    <span>
                      <small>Created</small>
                      <strong>{formatDate(organization.createdAt)}</strong>
                    </span>
                    <span>
                      <small>Updated</small>
                      <strong>{formatDate(organization.updatedAt)}</strong>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
          <section className="panel join-code-panel">
            <div>
              <p className="eyebrow">Join</p>
              <h2>Join with organization code</h2>
            </div>
            <form className="join-code-form" onSubmit={handleJoinByCode}>
              <input name="code" placeholder="ORG-XXXXX-XXXXX-XXXXX" required />
              <button className="secondary-button" type="submit" disabled={joining}>
                {joining ? "Joining" : "Join organization"}
              </button>
            </form>
            {joinMessage && <p className="form-success">{joinMessage}</p>}
          </section>
        </>
      ) : organizations.length > 0 && organizationId ? (
        <section className="panel organization-detail-frame">
          <div className="organization-detail-nav">
            <Link className="secondary-button compact-button" to="/organization">
              <ArrowLeft size={16} />
              Back to organizations
            </Link>
          </div>
          {(organizationDetailError || organizationDetailLoading) && (
            <p className={organizationDetailError ? "form-error" : "muted-copy"}>
              {organizationDetailError ?? "Loading organization details."}
            </p>
          )}
          {organization && (
            <OrganizationManagementPanel
              onChanged={async () => {
                await reload();
                await reloadOrganization();
              }}
              organization={organization}
              session={session}
              setPageError={setOrganizationDetailError}
            />
          )}
          {!organization && !organizationDetailLoading && !organizationDetailError && (
            <section className="empty-state compact-empty">
              <Building2 size={28} />
              <strong>Organization not found</strong>
              <span>Choose an organization from the directory.</span>
              <Link className="secondary-button" to="/organization">
                Back to organizations
              </Link>
            </section>
          )}
        </section>
      ) : (
        <section className="panel no-organization-frame">
          <div className="section-head">
            <div>
              <p className="eyebrow">Organization access</p>
              <h2>Get started</h2>
            </div>
            <span className="muted-copy">Join an existing organization or request creator access.</span>
          </div>
          <div className="no-organization-grid">
            <section className="panel join-code-panel">
              <div>
                <p className="eyebrow">Join</p>
                <h2>Join with organization code</h2>
              </div>
              <form className="join-code-form" onSubmit={handleJoinByCode}>
                <input name="code" placeholder="ORG-XXXXX-XXXXX-XXXXX" required />
                <button className="secondary-button" type="submit" disabled={joining}>
                  {joining ? "Joining" : "Join organization"}
                </button>
              </form>
              {joinMessage && <p className="form-success">{joinMessage}</p>}
            </section>
            {canCreateOrganizations ? (
              <section className="panel no-organization-card">
                <OrganizationCreateForm
                  embedded
                  loading={loading}
                  onCreated={async (organizationId) => {
                    await reload();
                    navigate(`/organization/${organizationId}`);
                  }}
                  session={session}
                  setPageError={setError}
                />
              </section>
            ) : (
              <section className="panel empty-state compact-empty">
                <ShieldCheck size={28} />
                <strong>Creator rights required</strong>
                <span>Simple users can join organizations, but need approved creator rights to create one.</span>
                <Link className="secondary-button" to="/account">
                  Apply in My Account
                </Link>
              </section>
            )}
          </div>
        </section>
      )}
      {showCreateModal && canCreateOrganizations && (
        <OrganizationCreateModal
          loading={loading}
          onClose={() => setShowCreateModal(false)}
          onCreated={async (organizationId) => {
            await reload();
            setShowCreateModal(false);
            navigate(`/organization/${organizationId}`);
          }}
          session={session}
          setPageError={setError}
        />
      )}
    </section>
  );
}

function OrganizationCreateModal({
  loading,
  onClose,
  onCreated,
  session,
  setPageError
}: {
  loading: boolean;
  onClose: () => void;
  onCreated: (organizationId: string) => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="organization-modal-title"
        aria-modal="true"
        className="modal-panel organization-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Organizations</p>
            <h2 id="organization-modal-title">Create organization</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close organization form">
            <X size={17} />
          </button>
        </div>
        {modalError && <p className="form-error">{modalError}</p>}
        <OrganizationCreateForm
          embedded
          loading={loading}
          onCreated={async (organizationId) => {
            setModalError(null);
            setPageError(null);
            await onCreated(organizationId);
          }}
          session={session}
          setPageError={(error) => {
            setModalError(error);
            if (!error) {
              setPageError(null);
            }
          }}
        />
      </section>
    </div>
  );
}

function OrganizationCreateForm({
  embedded = false,
  loading,
  onCreated,
  session,
  setPageError
}: {
  embedded?: boolean;
  loading: boolean;
  onCreated: (organizationId: string) => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const organizationDraft = useFormDraft("goxai-draft-organization");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavedMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      const result = await createOrganization(session, {
        organizationName: getFormValue(event, "name"),
        workspaceName: getFormValue(event, "workspace"),
        organizationEmail: getFormValue(event, "email"),
        description: getFormValue(event, "description"),
        organizationType: getFormValue(event, "type"),
        planTier: getFormValue(event, "plan")
      });

      organizationDraft.clearDraft();
      setSavedMessage(`${result.organization.name} and ${result.workspace.name} are ready.`);
      await onCreated(result.organization.id);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to create organization.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={embedded ? "setup-form" : "panel setup-form"}
      onChange={organizationDraft.saveDraft}
      onSubmit={handleSubmit}
      ref={organizationDraft.formRef}
    >
      <div className="wide">
        <p className="eyebrow">Create</p>
        <h2>New organization</h2>
      </div>
      <label>
        Organization name
        <input name="name" placeholder="GoXAi Lab" required />
      </label>
      <label>
        Organization email
        <input name="email" placeholder="ops@example.com" type="email" />
      </label>
      <label>
        Workspace name
        <input name="workspace" placeholder="Default workspace" required />
      </label>
      <label>
        Type
        <select name="type" defaultValue="COMPANY">
          <option value="PERSONAL">Personal</option>
          <option value="COMPANY">Company</option>
          <option value="ENTERPRISE">Enterprise</option>
          <option value="MARKETPLACE_VENDOR">Marketplace vendor</option>
        </select>
      </label>
      <fieldset className="plan-picker wide">
        <legend>Plan</legend>
        <div className="plan-option-row">
          {planOptions.map((plan) => (
            <label className="plan-option" key={plan.value}>
              <input name="plan" type="radio" value={plan.value} defaultChecked={plan.value === "FREE"} />
              <strong>{plan.label}</strong>
              <span>{plan.price}</span>
              <small>{plan.detail}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="wide">
        Description
        <textarea name="description" placeholder="What does this organization do?" />
      </label>
      {savedMessage && <p className="form-success wide">{savedMessage}</p>}
      <button className="primary-button" type="submit" disabled={saving || loading}>
        <Building2 size={18} />
        {saving ? "Creating" : "Create organization"}
      </button>
    </form>
  );
}

function OrganizationManagementPanel({
  onChanged,
  organization,
  session,
  setPageError
}: {
  onChanged: () => Promise<void>;
  organization: OrganizationDetail;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const primaryWorkspace = organization.workspaces[0] ?? null;
  const { dbUser } = useAuth();
  const currentUserId = dbUser?.id ?? null;
  const canManageSettings = organization.capabilities.canUpdate;
  const canManageMembers = organization.capabilities.canManageMembers;
  const canShowSideColumn = canManageSettings || canManageMembers;

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await updateOrganization(session, organization.id, {
        name: getFormValue(event, "name"),
        email: getFormValue(event, "email"),
        description: getFormValue(event, "description"),
        type: getFormValue(event, "type"),
        accessMode: getFormValue(event, "accessMode"),
        joinCodeEnabled: new FormData(event.currentTarget).get("joinCodeEnabled") === "on",
        joinRequiresApproval: new FormData(event.currentTarget).get("joinRequiresApproval") === "on",
        planTier: getFormValue(event, "planTier")
      });
      setMessage("Organization settings updated.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update organization.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const email = getFormValue(event, "email");

    if (dbUser?.email && email.toLowerCase() === dbUser.email.toLowerCase()) {
      setPageError("You are already part of this organization. Your own role must be changed by another owner.");
      return;
    }

    setMemberSaving(true);

    try {
      await addOrganizationMember(session, organization.id, {
        email,
        role: getFormValue(event, "role")
      });
      form.reset();
      setMessage("Member added.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to add member.");
    } finally {
      setMemberSaving(false);
    }
  }

  async function handleDeleteOrganization() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await deleteOrganization(session, organization.id);
      setMessage("Organization deleted.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to delete organization.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`detail-layout organization-detail-layout${canShowSideColumn ? "" : " single-pane"}`}>
      <section className="content-column">
        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Organization details</p>
              <h2>{organization.name}</h2>
            </div>
            <span className="status-pill">{formatEnum(organization.currentUserRole)}</span>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Type</dt>
              <dd>{formatEnum(organization.type)}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{formatEnum(organization.planTier)}</dd>
            </div>
            <div>
              <dt>Members</dt>
              <dd>{organization.counts.members}</dd>
            </div>
            <div>
              <dt>Owners</dt>
              <dd>{organization.counts.owners}</dd>
            </div>
            <div>
              <dt>Projects</dt>
              <dd>{organization.counts.projects}</dd>
            </div>
            <div>
              <dt>Datasets</dt>
              <dd>{organization.counts.datasets}</dd>
            </div>
            <div>
              <dt>Privacy</dt>
              <dd>{formatEnum(organization.accessMode)}</dd>
            </div>
            <div>
              <dt>Join code</dt>
              <dd>
                {organization.joinCodeEnabled
                  ? `${organization.joinCode ?? "Generating"}${
                      organization.joinRequiresApproval ? " (approval required)" : ""
                    }`
                  : "Disabled"}
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{organization.email ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{primaryWorkspace?.name ?? "Organization wide"}</dd>
            </div>
            <div>
              <dt>Slug</dt>
              <dd>{organization.slug}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(organization.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(organization.updatedAt)}</dd>
            </div>
          </dl>
          <div className="description-block">
            <span>Description</span>
            <p>{organization.description || primaryWorkspace?.description || "No organization description has been added yet."}</p>
          </div>
        </section>

        {organization.capabilities.canViewMembers ? (
          <MembersTable
            canGrantOwnerRole={organization.capabilities.canGrantOwnerRole}
            currentUserId={currentUserId}
            members={organization.memberships}
            onChanged={onChanged}
            organizationId={organization.id}
            session={session}
            setPageError={setPageError}
          />
        ) : (
          <section className="panel empty-state compact-empty">
            <UserCheck size={28} />
            <strong>Member directory hidden</strong>
            <span>Your current role can view organization details, but member management is limited to owners and admins.</span>
          </section>
        )}

        <section className="panel">
          <div>
            <p className="eyebrow">Access</p>
            <h2>Role permissions</h2>
          </div>
          <RolePrivilegesPanel />
        </section>
      </section>

      {canShowSideColumn ? (
        <aside className="side-column">
          {message && <p className="form-success">{message}</p>}
          {canManageSettings ? (
            <section className="panel management-panel">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>Edit organization</h2>
              </div>
              <form className="management-grid" onSubmit={handleUpdate}>
                <label>
                  Name
                  <input name="name" defaultValue={organization.name} required />
                </label>
                <label>
                  Organization email
                  <input name="email" defaultValue={organization.email ?? ""} placeholder="ops@example.com" type="email" />
                </label>
                <label>
                  Type
                  <select name="type" defaultValue={organization.type}>
                    <option value="PERSONAL">Personal</option>
                    <option value="COMPANY">Company</option>
                    <option value="ENTERPRISE">Enterprise</option>
                    <option value="MARKETPLACE_VENDOR">Marketplace vendor</option>
                  </select>
                </label>
                <label>
                  Plan
                  <select name="planTier" defaultValue={organization.planTier}>
                    <option value="FREE">Free</option>
                    <option value="STARTER">Starter</option>
                    <option value="PRO">Pro</option>
                    <option value="BUSINESS">Business</option>
                    <option value="ENTERPRISE">Enterprise</option>
                  </select>
                </label>
                <label>
                  Privacy
                  <select name="accessMode" defaultValue={organization.accessMode}>
                    <option value="INVITE_ONLY">Invite only</option>
                    <option value="PUBLIC">Open public</option>
                    <option value="REQUEST_TO_JOIN">Request to join</option>
                    <option value="PRIVATE">Private</option>
                  </select>
                </label>
                <label className="check-row">
                  <input name="joinCodeEnabled" type="checkbox" defaultChecked={organization.joinCodeEnabled} />
                  Enable join code
                </label>
                <label className="check-row">
                  <input
                    name="joinRequiresApproval"
                    type="checkbox"
                    defaultChecked={organization.joinRequiresApproval}
                  />
                  Require approval for join-code requests
                </label>
                <label className="wide">
                  Description
                  <textarea name="description" defaultValue={organization.description ?? ""} />
                </label>
                <div className="row-actions wide">
                  <button className="primary-button" type="submit" disabled={saving}>
                    <Save size={18} />
                    {saving ? "Saving" : "Save organization"}
                  </button>
                  {organization.capabilities.canDelete && (
                    <button className="ghost-button danger-button" type="button" onClick={handleDeleteOrganization} disabled={saving}>
                      Delete empty organization
                    </button>
                  )}
                </div>
              </form>
            </section>
          ) : null}

          {canManageMembers ? (
            <section className="panel management-panel">
              <div>
                <p className="eyebrow">Members</p>
                <h2>Add member</h2>
              </div>
              <form className="management-grid" onSubmit={handleAddMember}>
                <label>
                  Member email
                  <input name="email" placeholder="teammate@example.com" type="email" required />
                </label>
                <label>
                  Role
                  <select name="role" defaultValue="ANNOTATOR">
                    {memberRoles
                      .filter((role) => organization.capabilities.canGrantOwnerRole || role !== "OWNER")
                      .map((role) => (
                        <option key={role} value={role}>
                          {formatEnum(role)}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="secondary-button" type="submit" disabled={memberSaving}>
                  <UserRoundPlus size={18} />
                  {memberSaving ? "Adding" : "Add member"}
                </button>
              </form>
            </section>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}

function RolePrivilegesPanel() {
  return (
    <section className="role-grid">
      {rolePrivileges.map((role) => (
        <article className="role-card" key={role.role}>
          <strong>{formatEnum(role.role)}</strong>
          <ul>
            {role.permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function MembersTable({
  canGrantOwnerRole,
  currentUserId,
  members,
  onChanged,
  organizationId,
  session,
  setPageError
}: {
  canGrantOwnerRole: boolean;
  currentUserId: string | null;
  members: MembershipSummary[];
  onChanged: () => Promise<void>;
  organizationId: string;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  return (
    <section className="table-panel">
      <div className="table-row member-head table-head">
        <span>Member</span>
        <span>Role</span>
        <span>Status</span>
        <span>Action</span>
      </div>
      {members.map((member) => (
        <MemberRow
          canGrantOwnerRole={canGrantOwnerRole}
          key={member.id}
          currentUserId={currentUserId}
          member={member}
          onChanged={onChanged}
          organizationId={organizationId}
          session={session}
          setPageError={setPageError}
        />
      ))}
    </section>
  );
}

function MemberRow({
  canGrantOwnerRole,
  currentUserId,
  member,
  onChanged,
  organizationId,
  session,
  setPageError
}: {
  canGrantOwnerRole: boolean;
  currentUserId: string | null;
  member: MembershipSummary;
  onChanged: () => Promise<void>;
  organizationId: string;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState(member.role);
  const isCurrentUser = currentUserId === member.user.id;
  const roleOptions = memberRoles.filter((item) => canGrantOwnerRole || item !== "OWNER" || member.role === "OWNER");

  async function saveRole() {
    if (isCurrentUser) {
      setPageError("You cannot edit your own organization membership. Ask another owner to make role changes.");
      return;
    }

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await updateOrganizationMember(session, organizationId, member.id, { role });
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update member.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember() {
    if (isCurrentUser) {
      setPageError("You cannot remove yourself from member management.");
      return;
    }

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await removeOrganizationMember(session, organizationId, member.id);
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to remove member.");
    } finally {
      setSaving(false);
    }
  }

  async function approveMember() {
    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await updateOrganizationMember(session, organizationId, member.id, { role, status: "ACTIVE" });
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to approve member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="table-row member-head project-row">
      <span>
        <strong>{member.user.name}</strong>
        <small>{member.user.email}</small>
      </span>
      <span>
        <select value={role} onChange={(event) => setRole(event.target.value)} disabled={isCurrentUser || (!canGrantOwnerRole && member.role === "OWNER")}>
          {roleOptions.map((item) => (
            <option key={item} value={item}>
              {formatEnum(item)}
            </option>
          ))}
        </select>
      </span>
      <span>
        <span className="status-pill compact">{formatEnum(member.status)}</span>
      </span>
      <span className="row-actions">
        {isCurrentUser ? (
          <span className="status-pill compact">Current user</span>
        ) : (
          <>
            {member.status === "INVITED" && (
              <button className="secondary-button compact-button" type="button" onClick={approveMember} disabled={saving}>
                Approve
              </button>
            )}
            <button className="secondary-button compact-button" type="button" onClick={saveRole} disabled={saving}>
              Save
            </button>
            <button className="ghost-button compact-button danger-button" type="button" onClick={removeMember} disabled={saving}>
              Remove
            </button>
          </>
        )}
      </span>
    </article>
  );
}
