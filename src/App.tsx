
import { useCallback, useEffect, useState } from "react";
import { AccountsPage } from "./components/AccountsPage";
import { AuthScreen } from "./components/AuthScreen";
import { CategoriesPage } from "./components/CategoriesPage";
import { BusinessPartnersPage } from "./components/BusinessPartnersPage";
import { CompanyGate } from "./components/CompanyGate";
import { CostCentersPage } from "./components/CostCentersPage";
import { Dashboard } from "./components/Dashboard";
import { FinancialObligationsPage } from "./components/FinancialObligationsPage";
import { ProposalsPage } from "./components/ProposalsPage";
import { ReportsPage } from "./components/ReportsPage";
import { CardsPage } from "./components/CardsPage";
import { RecurrencesPage } from "./components/RecurrencesPage";
import { RecurringSyncGate } from "./components/RecurringSyncGate";
import { TeamPage } from "./components/TeamPage";
import { AuditPage } from "./components/AuditPage";
import { AlertsPage } from "./components/AlertsPage";
import { ValoraAIPage } from "./components/ValoraAIPage";
import { CompanySettingsPage } from "./components/CompanySettingsPage";
import { TransactionsPage } from "./components/TransactionsPage";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { CompanyProvider, useCompany } from "./contexts/CompanyContext";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type Page =
  | "dashboard"
  | "transactions"
  | "payables"
  | "receivables"
  | "accounts"
  | "categories"
  | "cost-centers"
  | "customers"
  | "suppliers"
  | "proposals"
  | "reports"
  | "cards"
  | "recurrences"
  | "team"
  | "audit"
  | "alerts"
  | "ai"
  | "settings";

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
  ["◇", "Propostas", "proposals"],
  ["▥", "Relatórios", "reports"],
  ["▣", "Cartões", "cards"],
  ["⟳", "Recorrências", "recurrences"],
  ["●", "Alertas", "alerts"],
  ["✦", "Valora IA", "ai"],
];

const adminNav: Array<[string, string, Page]> = [
  ["♟", "Equipe", "team"],
  ["◌", "Auditoria", "audit"],
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

function CurrentPage({
  page,
  onNavigate,
  onAlertsChanged,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onAlertsChanged: () => void;
}) {
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
    case "proposals":
      return <ProposalsPage />;
    case "reports":
      return <ReportsPage />;
    case "cards":
      return <CardsPage />;
    case "recurrences":
      return <RecurrencesPage />;
    case "team":
      return <TeamPage />;
    case "audit":
      return <AuditPage />;
    case "alerts":
      return (
        <AlertsPage
          onNavigate={(target) => onNavigate(target)}
          onChanged={onAlertsChanged}
        />
      );
    case "ai":
      return <ValoraAIPage />;
    case "settings":
      return <CompanySettingsPage />;
    default:
      return <Dashboard onOpenAI={() => onNavigate("ai")} />;
  }
}

function Workspace() {
  const [page, setPage] = useState<Page>("dashboard");
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const { companies, activeCompany, activeRole, selectCompany } = useCompany();
  const { user, signOut } = useAuth();

  const refreshAlertCount = useCallback(async () => {
    if (!supabase || !activeCompany) {
      setUnreadAlerts(0);
      return;
    }

    const { error: refreshError } = await supabase.rpc("refresh_company_alerts", {
      p_company_id: activeCompany.id,
    });

    if (refreshError) return;

    const { data, error } = await supabase.rpc("list_company_alerts", {
      p_company_id: activeCompany.id,
      p_include_dismissed: false,
    });

    if (error) return;

    setUnreadAlerts(
      ((data ?? []) as Array<{ is_read: boolean; is_dismissed: boolean }>).filter(
        (item) => !item.is_read && !item.is_dismissed,
      ).length,
    );
  }, [activeCompany?.id]);

  useEffect(() => {
    void refreshAlertCount();

    const timer = window.setInterval(() => {
      void refreshAlertCount();
    }, 5 * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [refreshAlertCount]);

  useEffect(() => {
    void refreshAlertCount();
  }, [page, refreshAlertCount]);

  const navigation =
    activeRole === "owner" || activeRole === "admin"
      ? [...activeNav, ...adminNav]
      : activeNav;

  return (
    <div className={activeRole === "viewer" ? "shell role-viewer" : "shell"}>
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
          {activeRole && (
            <small className={"company-role-badge " + activeRole}>
              {activeRole === "owner"
                ? "Owner"
                : activeRole === "admin"
                  ? "Admin"
                  : activeRole === "member"
                    ? "Membro"
                    : "Somente leitura"}
            </small>
          )}
        </div>

        <nav>
          {navigation.map(([icon, label, target]) => (
            <button
              className={page === target ? "nav-item active" : "nav-item"}
              key={target}
              onClick={() => setPage(target)}
            >
              <span>{icon}</span> {label}
              {target === "alerts" && unreadAlerts > 0 && (
                <b className="nav-alert-badge">{unreadAlerts > 99 ? "99+" : unreadAlerts}</b>
              )}
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
          <button
            className={page === "settings" ? "settings active" : "settings"}
            onClick={() => setPage("settings")}
          >
            ⚙ Configurações
          </button>
          <button className="settings sign-out" onClick={() => void signOut()}>
            ⇥ Sair
          </button>
        </div>
      </aside>

      <main className="workspace">
        {activeRole === "viewer" && (
          <div className="viewer-banner">
            Modo somente leitura. Você pode consultar os dados, mas não alterar registros.
          </div>
        )}
        <RecurringSyncGate>
          <CurrentPage
            page={page}
            onNavigate={setPage}
            onAlertsChanged={() => void refreshAlertCount()}
          />
        </RecurringSyncGate>
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
