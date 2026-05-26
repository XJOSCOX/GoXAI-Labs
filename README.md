# GoXAi Lab

GoXAi Lab is an AI-native data operations platform for organizations, projects, datasets, assets, annotation templates, and annotation tasks.

Domain: `goxailab.com`

> Status: active development. The core SaaS foundation, dataset/template flow, R2 upload pipeline, and early annotation experience are working. This is not a finished production release yet.

## Master Plan Progress

This README tracks the current implementation against `Goxailab Master Platform Plan And Architecture.pdf`.

| Plan Area | Current Status | Notes |
| --- | --- | --- |
| Phase 0: Architecture and foundation | Mostly built | pnpm monorepo, React web app, Express API, Prisma database package, Supabase Auth/Postgres, Cloudflare R2, logging, and code-split frontend are in place. CI/CD, Redis, Dockerized dev/prod, and deployment automation are still pending. |
| Phase 1: Authentication and organizations | Partially built | Email/password auth through Supabase, onboarding, organizations, members, roles, project access, join codes, and audit/client logs are implemented. Google/GitHub login, password reset UX, MFA, and deeper policy screens are still pending. |
| Phase 2: Projects and datasets | Strongly in progress | Projects, datasets, templates, R2 assets, multi-file upload, structured CSV/JSON/JSONL imports, text task data, task generation, dataset version snapshots, and rollback are implemented. Resumable/chunk uploads and external storage connectors are still pending. |
| Phase 3: Annotation engine | In progress | Image bounding boxes and polygons, PDF page-region boxes with page metadata and lazy `pdf.js` rendering, text responses, template-aware task UI, autosave, zoom/pan, fullscreen work, keyboard shortcuts, region management, undo/redo edits, comments, review history, audio waveform range selection, video timestamp labels, PDF page markers, time-series drag selection, and first-pass audio/video/PDF/time-series source workspaces are started. Advanced media tools are still pending. |
| Phase 4: Realtime collaboration | Not started | No WebSocket/Redis presence or live collaboration yet. |
| Phase 5-6: Workflow and assignment | In progress | Task states, assign-self, start, draft, submit, project/dataset task folders, dataset queues, reviewer queues, approvals, rejections, comments, and rejected-task revision loops exist. SLA rules, automatic assignment, and consensus labeling are still pending. |
| Phase 7: AI-assisted labeling | Not started | Schema has future AI/model foundations, but no production AI workers or model-assisted labeling yet. |
| Phase 8-11: Analytics, marketplace, enterprise, scaling | Schema foundation only | Database models include future marketplace, wallet, notification, API key, webhook, and export concepts, but product workflows are not built yet. |

## What Is Built Now

### Monorepo And Runtime

- pnpm workspace monorepo with `apps`, `services`, `packages`, `docs`, `scripts`, `infrastructure`, and `docker`.
- `apps/web`: React + TypeScript + Vite web application.
- `services/api`: Node.js + Express + TypeScript API.
- `packages/database`: Prisma schema/client for Supabase Postgres.
- `packages/label-templates`: Label Studio-style built-in template library and validation scripts.
- Frontend routes are lazy-loaded for production code splitting.
- Backend/frontend typechecks and builds pass.

### Authentication And Accounts

- Supabase Auth signup/login with API bearer-token verification.
- Local `User` row sync from Supabase identity.
- Registration supports user profile and organization-backed onboarding.
- Onboarding gate before entering the app.
- Account settings and application status foundations.
- Super-admin/admin screens for user and application review foundations.

### Organizations, Roles, And Access

- Organizations with owners, members, roles, plans, privacy modes, and join codes.
- Organization roles: Owner, Admin, Manager, Reviewer, Annotator, Viewer.
- Project memberships are tracked separately from organization membership.
- Owner self-protection rules prevent accidental owner removal/demotion.
- Public, organization, and private project access modes.
- Audit/client logging for important app events and errors.

### Projects

- Create, list, view, edit, archive, restore, and delete projects when allowed.
- Project fields include organization, data type, access mode, member limit, external access, description, and instructions.
- Project detail pages show datasets, members, status, and management actions.
- Projects can contain multiple datasets for different task streams.

### Datasets And Assets

- Create, view, edit, archive, restore, and delete datasets.
- Dataset delete removes the dataset, registered files, and dataset tasks.
- Cloudflare R2 direct browser uploads through signed PUT URLs.
- Drag/drop, multi-file upload, folder upload, optional rename mode, and registered asset deletion.
- Text task entry for templates that bind to `$text`.
- Structured import for CSV, JSON, JSONL, and NDJSON:
  - Each row/object becomes one task data asset.
  - `text.csv` with a `text` column becomes one task per row after task generation.
- Asset quick preview and large image preview with signed R2 access URLs.
- Dataset version snapshots capture configuration, template, labels, tools, asset references, and task state summaries.
- Dataset rollback restores an older snapshot into a new immutable version without deleting current history.

### Templates

- Built-in Label Studio-style templates are stored in `packages/label-templates/templates`.
- Templates use XML/config files plus metadata, similar to Label Studio's pattern.
- Built-in templates cover image, text, audio, video, time-series, ranking/scoring, chat, generative AI, and structured-data parsing categories.
- Template validation checks config bindings and template metadata.
- Label settings UI includes:
  - Template browser.
  - Category browsing.
  - Built-in template selection.
  - Dataset template assignment.
  - Custom category/template management.
  - Code editing for label configs.

### Tasks And Annotation

- Generate tasks from dataset assets.
- Task home page groups work by project, then by dataset queue.
- Users can choose which dataset queue to work on.
- Task queue actions include start and assign-to-self.
- Annotation saves drafts and submits completed work.
- Autosave is supported for annotation changes.
- Image annotation currently supports bounding boxes and polygons.
- Polygon workflow includes point creation, auto-close behavior, cancel path, region deletion, label lock mode, and moving regions.
- Image workspace supports zoom, pan, and fullscreen working mode.
- PDF region annotation supports lazy page rendering, page/source metadata, and click-to-create OCR text block overlays when task metadata includes OCR blocks.
- Text templates render text sources and response controls instead of image drawing tools.
- Non-region template answers are stored in Label Studio-style `results` JSON.

## Current Monorepo Layout

```text
GoXAI/
+-- apps/
|   +-- web/              # React + Vite SaaS frontend
|   +-- studio/           # Reserved for future standalone annotation engine
+-- services/
|   +-- api/              # Express API
+-- packages/
|   +-- database/         # Prisma schema and database client
|   +-- label-templates/  # Built-in Label Studio-style template library
|   +-- config/           # Reserved shared config package
|   +-- types/            # Reserved shared types package
|   +-- ui/               # Reserved shared UI package
+-- docs/                 # Setup and architecture notes
+-- scripts/              # Utility scripts
+-- infrastructure/       # Reserved infrastructure/deployment files
+-- docker/               # Reserved Docker setup
+-- test-data/            # Local import samples
```

## Tech Stack

- Package manager: pnpm workspaces
- Frontend: React, TypeScript, Vite, React Router, Lucide icons
- Backend: Node.js, Express, TypeScript
- Database: Supabase Postgres + Prisma
- Auth: Supabase Auth
- Object storage: Cloudflare R2
- Template format: Label Studio-style XML/config metadata

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
pnpm --filter @goxai/api build
pnpm --filter @goxai/web typecheck
pnpm --filter @goxai/web build
pnpm --filter @goxai/database db:validate
pnpm --filter @goxai/database db:generate
pnpm --filter @goxai/database db:push
pnpm --filter @goxai/database db:studio
pnpm --filter @goxai/label-templates validate
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
- `/api/applications`
- `/api/admin`
- `/api/organizations`
- `/api/projects`
- `/api/datasets`
- `/api/assets`
- `/api/annotation-templates`
- `/api/tasks`
- `/api/logs/client`

Most app routes require a valid Supabase bearer token.

## More Docs

- Supabase setup: `docs/supabase.md`
- Cloudflare R2 setup: `docs/r2.md`
- Role permissions: `docs/rbac.md`
- Built-in templates: `packages/label-templates/templates/README.md`

## Near-Term Priorities

The project plan says not to start with Kubernetes, marketplace systems, advanced analytics, or complex AI. The current practical priorities are:

1. Harden the annotation UX for image and text tasks.
2. Expand advanced media-specific editors for video frame regions, OCR extraction review tools, and deeper waveform/time-series controls.
3. Add resumable/chunk uploads for large files.
4. Add external storage connectors.
5. Add SLA/priority workflow rules for review queues.
6. Add automated tests around tasks, templates, dataset imports, versions, and permissions.

## Current Development Rule

Treat archive as reversible and delete as permanent:

- Archive keeps records and can be restored.
- Dataset delete removes the dataset, registered dataset files, and dataset tasks.
- Project delete is allowed only after datasets and registered project files are gone.
