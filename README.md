# GoXAi Lab

GoXAi Lab is an AI data labeling and studio operations platform for organizations, projects, datasets, assets, and annotation tasks.

Domain: `goxailab.com`

> Status: still in progress. The foundation is working, but this is not a finished production release yet.

## What Is Built

- pnpm monorepo with `apps`, `services`, `packages`, `docs`, `scripts`, `infrastructure`, and `docker`.
- React + TypeScript + Vite web app in `apps/web`.
- Node.js + Express + TypeScript API in `services/api`.
- Prisma database package in `packages/database`.
- Supabase Auth integration for signup, login, user identity, and backend token verification.
- Supabase Postgres connection through Prisma.
- Cloudflare R2 direct browser uploads through signed URLs.
- Light/dark theme UI with GoXAi Lab branding.
- Protected app routes, onboarding gate, and logout flow.
- Dashboard, organization, project, dataset, asset, and task views.
- Backend audit/client logging for important app events and errors.

## Current Product Features

### Authentication

- Users sign up through Supabase Auth.
- Frontend sends the Supabase access token to the API.
- API verifies the token and creates/syncs the local `User` row.
- Signup supports simple users and organization-backed users.
- Password requirements are shown during registration.
- Onboarding must be completed before a user can continue into the app.
- Users get referral/API-style codes in the database foundation.

### Organizations

- Create, list, view, update, and delete empty organizations.
- Organization detail pages use unique organization IDs in the URL.
- Organization cards show summary information such as plan, privacy, owners, members, projects, datasets, slug, workspace, created date, and updated date.
- Organization owners can add and remove members.
- Owner self-protection rules prevent owners from removing or downgrading themselves accidentally.
- Join codes allow users to join organizations when enabled.
- Organization privacy modes are supported in the data model and UI.

### Roles And Access

- Organization roles: Owner, Admin, Manager, Reviewer, Annotator, Viewer.
- Project roles are tracked separately for project-scoped access.
- Only organization owners can create projects under an organization.
- Project owners/admins can edit projects, create datasets, upload assets, generate tasks, archive/restore, and delete when allowed.
- Viewers have read-only access.
- Public projects can be visible to signed-in users, while private/organization projects require access.

### Projects

- List available signed-in projects.
- Create projects with organization, data type, privacy, member limit, external member access, join code, description, and instructions.
- View project details in a max-width container layout.
- Edit project settings.
- Invite project members.
- Archive and restore projects.
- Permanently delete a project only after its datasets and registered project files are deleted.

### Datasets

- Create datasets under a project.
- View dataset details in a max-width two-column layout.
- Edit dataset settings in a modal.
- Archive and restore datasets.
- Permanently delete a whole dataset, including its registered files and dataset tasks.

### Assets And R2 Uploads

- Cloudflare R2 is used for large dataset files.
- Supabase Storage is intentionally not used for large dataset files.
- Uploads use signed R2 PUT URLs so large files do not pass through the API server.
- Drag/drop and multi-file upload are supported.
- Upload limit is currently 250 files at once.
- Users are warned to split larger uploads into folders.
- Optional rename mode supports prefix + random code naming.
- Registered files can be deleted one by one, by selection, or by registered folder prefix.
- Folder deletion only deletes registered files the user is allowed to manage.

### Tasks

- Generate dataset tasks from registered assets.
- List tasks by dataset/project.
- Assign task to self.
- Start tasks.
- Submit tasks.

## Monorepo Layout

```text
GoXAi/
+-- apps/
|   +-- web/          # React + Vite frontend
|   +-- studio/       # Reserved for future studio app
+-- services/
|   +-- api/          # Express API
+-- packages/
|   +-- database/     # Prisma schema and database client
|   +-- types/        # Reserved shared types package
|   +-- config/       # Reserved shared config package
|   +-- ui/           # Reserved shared UI package
+-- infrastructure/   # Reserved deployment/infrastructure files
+-- docs/             # Setup and architecture notes
+-- scripts/          # Utility scripts
+-- docker/           # Reserved Docker setup
```

## Tech Stack

- Package manager: pnpm workspaces
- Frontend: React, TypeScript, Vite, React Router, Lucide icons
- Backend: Node.js, Express, TypeScript
- Database: Supabase Postgres + Prisma
- Auth: Supabase Auth
- Object storage: Cloudflare R2

## Local Development

Install dependencies:

```bash
pnpm install
```

Copy `.env.example` to `.env` and fill the values:

```bash
cp .env.example .env
```

Generate Prisma client:

```bash
pnpm --filter @goxai/database db:generate
```

Push the Prisma schema to Supabase Postgres:

```bash
pnpm --filter @goxai/database db:push
```

Run the app:

```bash
pnpm dev
```

Default local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`
- API health: `http://localhost:4000/health`
- API status: `http://localhost:4000/api/status`

## Environment Variables

The root `.env` is used by the API and database package.

```env
PORT=4000

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

DATABASE_URL=
DIRECT_URL=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_ENDPOINT=
R2_PUBLIC_BASE_URL=
```

Notes:

- `R2_ENDPOINT` should use the Cloudflare R2 S3-compatible endpoint, usually `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com`.
- `DIRECT_URL` is optional, but useful if `DATABASE_URL` points to a pooled Supabase connection.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.

## Useful Commands

```bash
pnpm --filter @goxai/api typecheck
pnpm --filter @goxai/web typecheck
pnpm --filter @goxai/web build
pnpm --filter @goxai/database db:validate
pnpm --filter @goxai/database db:studio
pnpm check:r2-cors
```

## API Overview

Core routes currently include:

- `GET /health`
- `GET /api/status`
- `GET /api/config`
- `POST /api/auth/sync`
- `PATCH /api/auth/profile`
- `GET /api/auth/login-identifier`
- `/api/organizations`
- `/api/projects`
- `/api/datasets`
- `/api/assets`
- `/api/tasks`
- `/api/logs/client`

Most app routes require a valid Supabase bearer token.

## More Docs

- Supabase setup: `docs/supabase.md`
- Cloudflare R2 setup: `docs/r2.md`
- Role permissions: `docs/rbac.md`

## Still In Progress

The platform is actively being built. Important areas still in progress:

- Annotation editor and review/QA workflows.
- Complete task assignment queues and reviewer workflows.
- Marketplace, jobs, wallets, payouts, notifications, API keys, webhooks, and exports.
- Production deployment setup.
- Automated test coverage.
- More granular project/member permission screens.
- Full account settings and verification badge workflow.
- Production-ready observability, backups, and security hardening.

## Current Development Rule

Treat archive as reversible and delete as permanent:

- Archive keeps records and can be restored.
- Dataset delete removes the dataset, registered dataset files, and dataset tasks.
- Project delete is allowed only after datasets and registered project files are gone.
