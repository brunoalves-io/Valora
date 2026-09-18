import { useState } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { CompanyGate } from "./components/CompanyGate";
import { Dashboard } from "./components/Dashboard";
import { TransactionsPage } from "./components/TransactionsPage";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { CompanyProvider, useCompany } from "./contexts/CompanyContext";
import { isSupabaseConfigured } from "./lib/supabase";

type Page = "dashboard" | "transactions";

const futureNav = [
  ["↓", "Contas a pagar"],
  ["↑", "Contas a receber"],
  ["◉", "Contas e caixas"],
  ["▣", "Cartões"],
  ["♙", "Clientes"],
  ["♟", "Fornecedores"],
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
          Crie o arquivo <code>.env.local</code> com as variáveis abaixo e aplique a
          migration disponível na pasta <code>supabase/migrations</code>.
        </p>
        <pre>{`VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...`}</pre>
      </div>
    </div>
  );
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
          <button
            className={page === "dashboard" ? "nav-item active" : "nav-item"}
            onClick={() => setPage("dashboard")}
          >
            <span>⌂</span> Início
          </button>
          <button
            className={page === "transactions" ? "nav-item active" : "nav-item"}
            onClick={() => setPage("transactions")}
          >
            <span>↔</span> Lançamentos
          </button>
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
        {page === "dashboard" ? <Dashboard /> : <TransactionsPage />}
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
