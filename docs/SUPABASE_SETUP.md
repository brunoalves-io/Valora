# Supabase setup for Valora

This guide connects a fresh Supabase project to the Valora development build.

## 1. Create a Supabase project

Create a new project dedicated to Valora. Do not reuse the MasterSafe production database.

## 2. Apply the database migration

Open the Supabase SQL editor and run:

`supabase/migrations/20260918_001_initial_core.sql`

The migration creates:

- user profiles
- companies
- company memberships
- financial accounts
- categories
- transactions
- row-level security policies
- company creation RPC
- default account and categories for new companies

## 3. Configure authentication

In Supabase Authentication:

- Enable Email/Password authentication.
- For local development, you may disable email confirmation while the product is still being tested.
- Before production, re-enable confirmation and configure the official application URL.

## 4. Get the public project credentials

From the Supabase project settings, copy:

- Project URL
- Publishable/anon key

Never put the service-role key in the desktop frontend.

## 5. Create the local environment file

Copy `.env.example` to `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

The `.env.local` file is ignored by Git.

## 6. Install and run

```bash
npm install
npm run dev
```

For the desktop shell:

```bash
npm run tauri:dev
```

## 7. First functional test

1. Create a Valora account.
2. Sign in.
3. Create the first company.
4. Open **Lançamentos**.
5. Register one income and one expense.
6. Return to **Início**.
7. Confirm that the dashboard reflects the real transactions.

## Security model

Every business record contains a `company_id`. Row Level Security checks company membership before returning or changing data.

Roles currently supported:

- `owner`
- `admin`
- `member`
- `viewer`

The first user who creates a company becomes its owner.

## Not included in this phase

- Open Finance
- direct bank integrations
- NFS-e
- DDA
- official WhatsApp integrations
