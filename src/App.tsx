
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

const activeNav: Array<[string, Page]> = [
  ["Início", "dashboard"],
  ["Lançamentos", "transactions"],
  ["Contas a pagar", "payables"],
  ["Contas a receber", "receivables"],
  ["Contas e caixas", "accounts"],
  ["Categorias", "categories"],
  ["Centros de custo", "cost-centers"],
  ["Clientes", "customers"],
  ["Fornecedores", "suppliers"],
  ["Propostas", "proposals"],
  ["Relatórios", "reports"],
  ["Cartões", "cards"],
  ["Recorrências", "recurrences"],
  ["Alertas", "alerts"],
  ["Valora IA", "ai"],
];

const adminNav: Array<[string, Page]> = [
  ["Equipe", "team"],
  ["Auditoria", "audit"],
];

function SidebarIcon({
  name,
}: {
  name: Page | "logout";
}) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <path d="M3 10.8 12 3l9 7.8" />
          <path d="M5.5 9.6V21h13V9.6" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      );
    case "transactions":
      return (
        <svg {...common}>
          <path d="M7 7h13" />
          <path d="m17 4 3 3-3 3" />
          <path d="M17 17H4" />
          <path d="m7 14-3 3 3 3" />
        </svg>
      );
    case "payables":
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
          <path d="M5 21h14" />
        </svg>
      );
    case "receivables":
      return (
        <svg {...common}>
          <path d="M12 21V9" />
          <path d="m7.5 13.5 4.5-4.5 4.5 4.5" />
          <path d="M5 3h14" />
        </svg>
      );
    case "accounts":
      return (
        <svg {...common}>
          <path d="M4 7.5h15.5A1.5 1.5 0 0 1 21 9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
          <path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" />
        </svg>
      );
    case "categories":
      return (
        <svg {...common}>
          <path d="M3 7V3h4" />
          <path d="M3 3l8.8 8.8a2 2 0 0 1 0 2.8l-2.2 2.2a2 2 0 0 1-2.8 0L3 13" />
          <path d="M14 7.5 21 14.5 14.5 21" />
        </svg>
      );
    case "cost-centers":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1" />
        </svg>
      );
    case "customers":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c.8-3.7 3.2-5.5 7-5.5s6.2 1.8 7 5.5" />
        </svg>
      );
    case "suppliers":
      return (
        <svg {...common}>
          <path d="M3 9h12v8H3z" />
          <path d="M15 12h3l3 3v2h-6z" />
          <circle cx="7" cy="19" r="1.5" />
          <circle cx="18" cy="19" r="1.5" />
          <path d="M5 6h8" />
        </svg>
      );
    case "proposals":
      return (
        <svg {...common}>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5" />
          <path d="M9 12h6M9 16h5" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20H2" />
        </svg>
      );
    case "cards":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3 10h18" />
          <path d="M7 15h4" />
        </svg>
      );
    case "recurrences":
      return (
        <svg {...common}>
          <path d="M20 7v5h-5" />
          <path d="M4 17v-5h5" />
          <path d="M6.2 8.2A7 7 0 0 1 18.8 7L20 12" />
          <path d="M17.8 15.8A7 7 0 0 1 5.2 17L4 12" />
        </svg>
      );
    case "alerts":
      return (
        <svg {...common}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
      );
    case "ai":
      return (
        <svg {...common}>
          <path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3Z" />
          <path d="m18.5 13 1 2.5L22 16.5l-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" />
          <path d="m5 14 .7 1.8 1.8.7-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14Z" />
        </svg>
      );
    case "team":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c.6-3.2 2.4-4.8 5.5-4.8s4.9 1.6 5.5 4.8" />
          <path d="M15 6.5a3 3 0 0 1 0 5.8" />
          <path d="M16 14.6c2.5.5 4 2 4.5 4.4" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <path d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6l-7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M10 5H5v14h5" />
          <path d="M14 8l4 4-4 4" />
          <path d="M18 12H9" />
        </svg>
      );
    default:
      return null;
  }
}

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
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [companyMenuError, setCompanyMenuError] = useState("");
  const { companies, activeCompany, activeRole, selectCompany, createCompany } = useCompany();
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

  function roleLabel(role: "owner" | "admin" | "member" | "viewer") {
    if (role === "owner") return "Líder";
    if (role === "admin") return "Administrador";
    if (role === "member") return "Membro";
    return "Somente leitura";
  }

  function chooseCompany(companyId: string) {
    selectCompany(companyId);
    setCompanyMenuOpen(false);
    setCreatingCompany(false);
    setCompanyMenuError("");
    setPage("dashboard");
  }

  async function addCompany() {
    const cleanName = newCompanyName.trim();
    if (cleanName.length < 2) {
      setCompanyMenuError("Informe um nome válido para a empresa.");
      return;
    }

    setCompanyMenuError("");

    try {
      await createCompany(cleanName);
      setNewCompanyName("");
      setCreatingCompany(false);
      setCompanyMenuOpen(false);
      setPage("settings");
    } catch (error) {
      setCompanyMenuError(
        error instanceof Error
          ? error.message
          : "Não foi possível criar a empresa.",
      );
    }
  }

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

        <div
          className="company-switcher"
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (!next || !event.currentTarget.contains(next)) {
              setCompanyMenuOpen(false);
              setCreatingCompany(false);
              setCompanyMenuError("");
            }
          }}
        >
          <span>EMPRESA</span>

          <div className="company-switcher-control">
            <button
              type="button"
              className={companyMenuOpen ? "company-switcher-trigger open" : "company-switcher-trigger"}
            onClick={() => {
              setCompanyMenuOpen((value) => !value);
              setCompanyMenuError("");
            }}
              aria-expanded={companyMenuOpen}
              aria-haspopup="menu"
            >
              <span className="company-switcher-avatar">
              {(activeCompany?.name?.slice(0, 1) ?? "E").toUpperCase()}
            </span>
            <span className="company-switcher-name">{activeCompany?.name ?? "Empresa"}</span>
            <svg
              className="company-switcher-chevron"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m7 10 5 5 5-5" />
            </svg>
            </button>

            {companyMenuOpen && (
            <div className="company-menu" role="menu">
              <div className="company-menu-heading">
                <strong>Suas empresas</strong>
                <span>{companies.length} vinculada(s)</span>
              </div>

              <div className="company-menu-list">
                {companies.map(({ company, role }) => (
                  <button
                    type="button"
                    key={company.id}
                    className={
                      company.id === activeCompany?.id
                        ? "company-menu-item active"
                        : "company-menu-item"
                    }
                    onClick={() => chooseCompany(company.id)}
                    role="menuitem"
                  >
                    <span className="company-menu-avatar">
                      {company.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="company-menu-copy">
                      <strong>{company.name}</strong>
                      <small>{roleLabel(role)}</small>
                    </span>
                    {company.id === activeCompany?.id && (
                      <span className="company-menu-check">✓</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="company-menu-divider" />

              {!creatingCompany ? (
                <>
                  <button
                    type="button"
                    className="company-menu-action"
                    onClick={() => {
                      setPage("settings");
                      setCompanyMenuOpen(false);
                    }}
                  >
                    <SidebarIcon name="settings" />
                    <span>
                      <strong>Configurações da empresa</strong>
                      <small>Dados cadastrais, contato e identidade</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    className="company-menu-action create"
                    onClick={() => {
                      setCreatingCompany(true);
                      setCompanyMenuError("");
                    }}
                  >
                    <span className="company-menu-plus">+</span>
                    <span>
                      <strong>Nova empresa</strong>
                      <small>Crie outro ambiente financeiro separado</small>
                    </span>
                  </button>
                </>
              ) : (
                <div className="company-create-inline">
                  <label>
                    Nome da nova empresa
                    <input
                      value={newCompanyName}
                      onChange={(event) => {
                        setNewCompanyName(event.target.value);
                        setCompanyMenuError("");
                      }}
                      placeholder="Ex.: Nova empresa"
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void addCompany();
                        }
                        if (event.key === "Escape") {
                          setCreatingCompany(false);
                          setCompanyMenuError("");
                        }
                      }}
                    />
                  </label>

                  {companyMenuError && (
                    <small className="company-menu-error">{companyMenuError}</small>
                  )}

                  <div className="company-create-actions">
                    <button
                      type="button"
                      className="company-create-cancel"
                      onClick={() => {
                        setCreatingCompany(false);
                        setNewCompanyName("");
                        setCompanyMenuError("");
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="company-create-confirm"
                      onClick={() => void addCompany()}
                    >
                      Criar empresa
                    </button>
                  </div>
                </div>
              )}
              </div>
            )}
          </div>

          {activeRole && (
            <small className={"company-role-badge " + activeRole}>
              {roleLabel(activeRole)}
            </small>
          )}
        </div>

        <nav>
          {navigation.map(([label, target]) => (
            <button
              className={page === target ? "nav-item active" : "nav-item"}
              key={target}
              onClick={() => setPage(target)}
            >
              <span className="nav-icon">
                <SidebarIcon name={target} />
              </span>
              <span className="nav-label">{label}</span>
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
            <span className="nav-icon">
              <SidebarIcon name="settings" />
            </span>
            <span className="nav-label">Configurações</span>
          </button>
          <button className="settings sign-out" onClick={() => void signOut()}>
            <span className="nav-icon">
              <SidebarIcon name="logout" />
            </span>
            <span className="nav-label">Sair</span>
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
