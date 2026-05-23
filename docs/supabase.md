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
