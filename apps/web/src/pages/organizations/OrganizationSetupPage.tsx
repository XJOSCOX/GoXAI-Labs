import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Building2, Save, ShieldCheck, UserCheck, UserRoundPlus, X } from "lucide-react";
import {
  addOrganizationMember,
  createOrganization,
  deleteOrganization,
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
  const { session } = useAuth();
  const navigate = useNavigate();
  const { organizationId = "" } = useParams();
  const { error, loading, organizations, reload, setError } = useOrganizations(session);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const {
    error: organizationDetailError,
    loading: organizationDetailLoading,
    organization,
    reload: reloadOrganization,
    setError: setOrganizationDetailError
  } = useOrganization(session, organizationId);

  return (
    <section className="page-stack organization-page">
      {organizationId && (
        <div className="page-actions">
          <Link className="back-link" to="/organization">
            All organizations
          </Link>
          {organizations.length > 0 && (
            <button className="primary-button" type="button" onClick={() => setShowCreateModal(true)}>
              <Building2 size={18} />
              New organization
            </button>
          )}
        </div>
      )}
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
                <button className="primary-button" type="button" onClick={() => setShowCreateModal(true)}>
                  <Building2 size={18} />
                  New organization
                </button>
              </div>
            </div>
            <div className="org-card-grid">
              {organizations.map((organization) => (
                <Link
                  className="org-summary-card"
                  key={organization.id}
                  to={`/organization/${organization.id}`}
                >
                  <span>
                    <strong>{organization.name}</strong>
                    <small>{organization.workspace?.name ?? "Organization wide"}</small>
                  </span>
                  <span className="org-summary-meta">
                    <span>{formatEnum(organization.type)}</span>
                    <span>{formatEnum(organization.planTier)}</span>
                  </span>
                  <span className="org-summary-footer">
                    <span className="status-pill compact">{formatEnum(organization.role)}</span>
                    <small>Updated {formatDate(organization.updatedAt)}</small>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : organizations.length > 0 && organizationId ? (
        <>
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
            <section className="panel empty-state compact-empty">
              <Building2 size={28} />
              <strong>Organization not found</strong>
              <span>Choose an organization from the directory.</span>
              <Link className="secondary-button" to="/organization">
                Back to organizations
              </Link>
            </section>
          )}
        </>
      ) : (
        <div className="single-column">
          <OrganizationCreateForm
            loading={loading}
            onCreated={async (organizationId) => {
              await reload();
              navigate(`/organization/${organizationId}`);
            }}
            session={session}
            setPageError={setError}
          />
        </div>
      )}
      {showCreateModal && (
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

    setMemberSaving(true);

    try {
      await addOrganizationMember(session, organization.id, {
        email: getFormValue(event, "email"),
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
    <section className="detail-layout organization-detail-layout">
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
              <dd>{organization.memberships.length}</dd>
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
              <dt>Updated</dt>
              <dd>{formatDate(organization.updatedAt)}</dd>
            </div>
          </dl>
          <div className="description-block">
            <span>Description</span>
            <p>{organization.description || primaryWorkspace?.description || "No organization description has been added yet."}</p>
          </div>
        </section>

        <MembersTable
          members={organization.memberships}
          onChanged={onChanged}
          organizationId={organization.id}
          session={session}
          setPageError={setPageError}
        />

        <section className="panel">
          <div>
            <p className="eyebrow">Access</p>
            <h2>Role permissions</h2>
          </div>
          <RolePrivilegesPanel />
        </section>
      </section>

      <aside className="side-column">
        {message && <p className="form-success">{message}</p>}
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
            <label className="wide">
              Description
              <textarea name="description" defaultValue={organization.description ?? ""} />
            </label>
            <div className="row-actions wide">
              <button className="primary-button" type="submit" disabled={saving}>
                <Save size={18} />
                {saving ? "Saving" : "Save organization"}
              </button>
              <button className="ghost-button danger-button" type="button" onClick={handleDeleteOrganization} disabled={saving}>
                Delete empty organization
              </button>
            </div>
          </form>
        </section>

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
                {memberRoles.map((role) => (
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
      </aside>
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
  members,
  onChanged,
  organizationId,
  session,
  setPageError
}: {
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
          key={member.id}
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
  member,
  onChanged,
  organizationId,
  session,
  setPageError
}: {
  member: MembershipSummary;
  onChanged: () => Promise<void>;
  organizationId: string;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState(member.role);

  async function saveRole() {
    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await updateOrganizationMember(session, organizationId, member.id, role);
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update member.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember() {
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

  return (
    <article className="table-row member-head project-row">
      <span>
        <strong>{member.user.name}</strong>
        <small>{member.user.email}</small>
      </span>
      <span>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          {memberRoles.map((item) => (
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
        <button className="secondary-button compact-button" type="button" onClick={saveRole} disabled={saving}>
          Save
        </button>
        <button className="ghost-button compact-button danger-button" type="button" onClick={removeMember} disabled={saving}>
          Remove
        </button>
      </span>
    </article>
  );
}
