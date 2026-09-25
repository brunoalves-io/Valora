<div align="center">

<img src="./valora-logo.svg" alt="Valora" width="190">

# Valora

### Gestão empresarial e financeira inteligente.

Valora is an intelligent business and financial management platform with cash flow, accounts payable and receivable, reports, customers, suppliers, proposals, automations, and AI-powered insights.

</div>

## Product vision

Valora starts as a financial and business management application for small companies and service businesses. The first versions focus on the core management experience without Open Finance, direct bank integrations, NFS-e, DDA, or official WhatsApp integrations.

### Planned modules

- Dashboard
- Financial transactions
- Accounts payable and receivable
- Accounts and cash balances
- Credit cards and invoices
- Customers and suppliers
- Categories and cost centers
- Cash flow
- DRE
- Reports
- Commercial proposals
- Recurring transactions
- Internal automations
- Team permissions and audit log
- Valora AI

## Technology

- React
- TypeScript
- Vite
- Tauri 2
- Supabase

## Development

Requirements:

- Node.js
- npm
- Rust toolchain
- Tauri system prerequisites

Install dependencies:

```bash
npm install
```

Run the web frontend:

```bash
npm run dev
```

Run the desktop application:

```bash
npm run tauri:dev
```

Build the frontend:

```bash
npm run build
```

Build the desktop application:

```bash
npm run tauri:build
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Do not commit secrets or service-role keys.

## Current status

Initial application scaffold and dashboard prototype.
