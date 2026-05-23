# Role permissions

GoXAi Lab uses organization membership roles for app-level authorization.

## Roles

| Role | Permissions |
| --- | --- |
| Owner | Full organization control, organization settings, member management, owner grants/removal, projects, datasets, assets, and tasks. |
| Admin | Organization settings, non-owner member management, projects, datasets, assets, and tasks. Cannot grant or remove Owner. |
| Manager | Project/dataset operations, asset upload/registration, task generation, and task work. |
| Reviewer | Read access plus task work. Reserved for review/QA flows as they are added. |
| Annotator | Read access plus task work. |
| Viewer | Read-only access. |

## Current enforcement

- Active members can read organization-owned projects, datasets, assets, and tasks.
- Owners and admins can edit organization settings.
- Owners and admins can add, update, and remove non-owner members.
- Only owners can grant Owner, remove Owner, or delete an empty organization.
- Owners, admins, and managers can create/edit/archive projects and datasets.
- Owners, admins, and managers can upload/register R2 assets.
- Owners, admins, and managers can generate tasks from datasets.
- Owners, admins, managers, reviewers, and annotators can assign/start/submit tasks.
- Viewers cannot mutate records.

Hard delete remains intentionally narrow. Projects and datasets are archived, while organizations can only be deleted when empty.
