# Supabase Setup

GoXAI uses Supabase for:

- PostgreSQL database
- Authentication
- User identity

GoXAI does not use Supabase Storage for large dataset files. Large dataset assets should use dedicated object storage or a data pipeline chosen later.

## Project Settings

Create a Supabase project from the Supabase dashboard, then copy these values into the local `.env` file:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
```

Use the anon key for user-scoped API work. Use the service role key only on trusted backend code.

## Prisma

Prisma connects to Supabase Postgres with `DATABASE_URL`.
If `DATABASE_URL` uses Supabase's pooled connection string, set `DIRECT_URL` to the direct connection string for Prisma CLI commands.

Run these from the repository root:

```bash
pnpm --filter @goxai/database db:validate
pnpm --filter @goxai/database db:generate
pnpm --filter @goxai/database db:push
```

The first application schema lives in `packages/database/prisma/schema.prisma`.

Application code should import `getPrismaClient` from `@goxai/database` when it needs database queries.
