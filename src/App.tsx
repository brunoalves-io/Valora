
import { useState } from "react";
import { AccountsPage } from "./components/AccountsPage";
import { AuthScreen } from "./components/AuthScreen";
import { CategoriesPage } from "./components/CategoriesPage";
import { BusinessPartnersPage } from "./components/BusinessPartnersPage";
import { CompanyGate } from "./components/CompanyGate";
import { CostCentersPage } from "./components/CostCentersPage";
import { Dashboard } from "./components/Dashboard";
import { FinancialObligationsPage } from "./components/FinancialObligationsPage";
import { TransactionsPage } from "./components/TransactionsPage";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { CompanyProvider, useCompany } from "./contexts/CompanyContext";
import { isSupabaseConfigured } from "./lib/supabase";

type Page =
  | "dashboard"
  | "transactions"
  | "payables"
  | "receivables"
  | "accounts"
  | "categories"
  | "cost-centers"
  | "customers"
  | "suppliers";

const activeNav: Array<[string, string, Page]> = [
  ["⌂", "Início", "dashboard"],
  ["↔", "Lançamentos", "transactions"],
  ["↓", "Contas a pagar", "payables"],
  ["↑", "Contas a receber", "receivables"],
  ["◉", "Contas e caixas", "accounts"],
  ["◆", "Categorias", "categories"],
  ["◎", "Centros de custo", "cost-centers"],
  ["♙", "Clientes", "customers"],
  ["♟", "Fornecedores", "suppliers"],
];

const futureNav = [
  ["▣", "Cartões"],
  ["◇", "Propostas"],
  ["▥", "Relatórios"],
  ["✦", "Valora IA"],
];

function MissingConfiguration() {
  return (
    <div className="config-page">
      <div className="config-card">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>Valora</strong>
            <span>Configuração inicial</span>
          </div>
        </div>
        <p className="eyebrow">SUPABASE</p>
        <h1>Falta conectar o banco de dados</h1>
        <p>
          Crie o arquivo <code>.env.local</code> com as variáveis abaixo e aplique as
          migrations disponíveis na pasta <code>supabase/migrations</code>.
        </p>
        <pre>{`VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...`}</pre>
      </div>
    </div>
  );
}

function CurrentPage({ page }: { page: Page }) {
  switch (page) {
    case "transactions":
      return <TransactionsPage />;
    case "payables":
      return <FinancialObligationsPage type="expense" />;
    case "receivables":
      return <FinancialObligationsPage type="income" />;
    case "accounts":
      return <AccountsPage />;
    case "categories":
      return <CategoriesPage />;
    case "cost-centers":
      return <CostCentersPage />;
    case "customers":
      return <BusinessPartnersPage view="customer" />;
    case "suppliers":
      return <BusinessPartnersPage view="supplier" />;
    default:
      return <Dashboard />;
  }
}

function Workspace() {
  const [page, setPage] = useState<Page>("dashboard");
  const { companies, activeCompany, selectCompany } = useCompany();
  const { user, signOut } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>Valora</strong>
            <span>Gestão inteligente</span>
          </div>
        </div>

        <div className="company-switcher">
          <span>EMPRESA</span>
          <select
            value={activeCompany?.id ?? ""}
            onChange={(event) => selectCompany(event.target.value)}
          >
            {companies.map(({ company }) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>

        <nav>
          {activeNav.map(([icon, label, target]) => (
            <button
              className={page === target ? "nav-item active" : "nav-item"}
              key={target}
              onClick={() => setPage(target)}
            >
              <span>{icon}</span> {label}
            </button>
          ))}

          <div className="nav-divider" />

          {futureNav.map(([icon, label]) => (
            <button className="nav-item disabled" key={label} disabled title="Em breve">
              <span>{icon}</span> {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-mini">
            <div className="user-avatar">
              {(user?.email?.slice(0, 1) ?? "U").toUpperCase()}
            </div>
            <div>
              <strong>{user?.user_metadata?.full_name || "Usuário"}</strong>
              <small>{user?.email}</small>
            </div>
          </div>
          <button className="settings" onClick={() => void signOut()}>
            ⇥ Sair
          </button>
        </div>
      </aside>

      <main className="workspace">
        <CurrentPage page={page} />
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) return <div className="center-screen">Abrindo o Valora...</div>;
  if (!user) return <AuthScreen />;

  return (
    <CompanyProvider>
      <CompanyGate>
        <Workspace />
      </CompanyGate>
    </CompanyProvider>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <MissingConfiguration />;

  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
