
import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type AlertSeverity = "info" | "warning" | "critical";
type AlertTarget = "payables" | "receivables" | "cards" | "reports";

type AlertItem = {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source_type: string | null;
  source_id: string | null;
  target_page: AlertTarget | null;
  reference_date: string | null;
  amount: number | string | null;
  created_at: string;
  updated_at: string;
  is_read: boolean;
  is_dismissed: boolean;
};

type RuleKind =
  | "expense_due"
  | "income_due"
  | "expense_overdue"
  | "income_overdue"
  | "card_statement_due"
  | "cash_projection";

type AutomationRule = {
  id: string;
  kind: RuleKind;
  enabled: boolean;
  days_before: number;
  horizon_days: number;
  threshold: number | string;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const ruleMeta: Record<
  RuleKind,
  { title: string; description: string; mode: "days" | "toggle" | "projection" }
> = {
  expense_due: {
    title: "Contas a pagar vencendo",
    description: "Avisa antes do vencimento de despesas pendentes.",
    mode: "days",
  },
  income_due: {
    title: "Contas a receber vencendo",
    description: "Avisa antes do vencimento de receitas pendentes.",
    mode: "days",
  },
  expense_overdue: {
    title: "Contas a pagar atrasadas",
    description: "Sinaliza despesas que já passaram do vencimento.",
    mode: "toggle",
  },
  income_overdue: {
    title: "Contas a receber atrasadas",
    description: "Sinaliza receitas que já passaram do vencimento.",
    mode: "toggle",
  },
  card_statement_due: {
    title: "Faturas de cartão",
    description: "Avisa antes do vencimento e mantém faturas vencidas em destaque.",
    mode: "days",
  },
  cash_projection: {
    title: "Projeção de caixa",
    description: "Avisa quando o saldo projetado ficar abaixo do limite definido.",
    mode: "projection",
  },
};

const severityLabels: Record<AlertSeverity, string> = {
  info: "Informativo",
  warning: "Atenção",
  critical: "Crítico",
};

export function AlertsPage({
  onNavigate,
  onChanged,
}: {
  onNavigate: (target: AlertTarget) => void;
  onChanged: () => void;
}) {
  const { activeCompany, activeRole } = useCompany();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [filter, setFilter] = useState<"all" | "unread" | AlertSeverity>("all");
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const canConfigure = activeRole === "owner" || activeRole === "admin";

  async function load(refresh = true) {
    if (!supabase || !activeCompany) return;

    setLoading(true);
    setError("");

    if (refresh) {
      const { error: refreshError } = await supabase.rpc("refresh_company_alerts", {
        p_company_id: activeCompany.id,
      });

      if (refreshError) {
        setError(refreshError.message);
        setLoading(false);
        return;
      }
    }

    const [alertResult, ruleResult] = await Promise.all([
      supabase.rpc("list_company_alerts", {
        p_company_id: activeCompany.id,
        p_include_dismissed: includeDismissed,
      }),
      supabase
        .from("automation_rules")
        .select("id, kind, enabled, days_before, horizon_days, threshold")
        .eq("company_id", activeCompany.id)
        .order("kind"),
    ]);

    if (alertResult.error || ruleResult.error) {
      setError(
        alertResult.error?.message ||
          ruleResult.error?.message ||
          "Não foi possível carregar os alertas.",
      );
    } else {
      setAlerts((alertResult.data ?? []) as AlertItem[]);
      setRules((ruleResult.data ?? []) as AutomationRule[]);
    }

    setLoading(false);
    onChanged();
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id, includeDismissed]);

  const summary = useMemo(
    () => ({
      total: alerts.filter((item) => !item.is_dismissed).length,
      unread: alerts.filter((item) => !item.is_read && !item.is_dismissed).length,
      critical: alerts.filter(
        (item) => item.severity === "critical" && !item.is_dismissed,
      ).length,
      warning: alerts.filter(
        (item) => item.severity === "warning" && !item.is_dismissed,
      ).length,
    }),
    [alerts],
  );

  const filteredAlerts = useMemo(() => {
    return alerts.filter((item) => {
      if (filter === "unread") return !item.is_read;
      if (filter === "critical" || filter === "warning" || filter === "info") {
        return item.severity === filter;
      }
      return true;
    });
  }, [alerts, filter]);

  async function setState(item: AlertItem, action: "read" | "unread" | "dismiss" | "restore") {
    if (!supabase) return;

    setError("");
    const { error: stateError } = await supabase.rpc("set_alert_state", {
      p_alert_id: item.id,
      p_action: action,
    });

    if (stateError) {
      setError(stateError.message);
      return;
    }

    await load(false);
  }

  async function openAlert(item: AlertItem) {
    if (!item.target_page) return;

    if (!item.is_read) {
      await setState(item, "read");
    }

    onNavigate(item.target_page);
  }

  async function refreshNow() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  async function markAllRead() {
    if (!supabase) return;

    const unread = alerts.filter((item) => !item.is_read && !item.is_dismissed);
    setError("");

    for (const item of unread) {
      const { error: stateError } = await supabase.rpc("set_alert_state", {
        p_alert_id: item.id,
        p_action: "read",
      });
      if (stateError) {
        setError(stateError.message);
        break;
      }
    }

    await load(false);
  }

  async function updateRule(
    rule: AutomationRule,
    patch: Partial<Pick<AutomationRule, "enabled" | "days_before" | "horizon_days" | "threshold">>,
  ) {
    if (!supabase || !canConfigure) return;

    setError("");

    const { error: updateError } = await supabase
      .from("automation_rules")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rule.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setRules((current) =>
      current.map((item) => (item.id === rule.id ? { ...item, ...patch } : item)),
    );
  }

  async function saveSettings() {
    setShowSettings(false);
    await refreshNow();
  }

  return (
    <>
      <header className="page-header split">
        <div>
          <p className="eyebrow">AUTOMAÇÕES</p>
          <h1>Alertas</h1>
          <p>O Valora monitora vencimentos, faturas e projeção de caixa para você.</p>
        </div>
        <div className="header-actions">
          {canConfigure && (
            <button className="ghost" onClick={() => setShowSettings((value) => !value)}>
              {showSettings ? "Fechar regras" : "Configurar regras"}
            </button>
          )}
          <button className="primary" onClick={() => void refreshNow()} disabled={refreshing}>
            {refreshing ? "Atualizando..." : "Atualizar alertas"}
          </button>
        </div>
      </header>

      <section className="metrics alert-metrics">
        <article className="metric-card">
          <span>Ativos</span>
          <strong>{summary.total}</strong>
          <small>Alertas atuais</small>
        </article>
        <article className="metric-card">
          <span>Não lidos</span>
          <strong>{summary.unread}</strong>
          <small>Precisam da sua atenção</small>
        </article>
        <article className="metric-card">
          <span>Críticos</span>
          <strong className={summary.critical ? "negative-value" : ""}>
            {summary.critical}
          </strong>
          <small>Vencidos ou caixa crítico</small>
        </article>
        <article className="metric-card">
          <span>Atenção</span>
          <strong>{summary.warning}</strong>
          <small>Próximos vencimentos</small>
        </article>
      </section>

      {showSettings && canConfigure && (
        <section className="panel automation-settings">
          <div className="panel-title automation-settings-title">
            <div>
              <h2>Regras automáticas</h2>
              <p>Ative, desative e ajuste quando cada alerta deve aparecer.</p>
            </div>
          </div>

          <div className="automation-rule-grid">
            {rules.map((rule) => {
              const meta = ruleMeta[rule.kind];
              if (!meta) return null;

              return (
                <article
                  className={rule.enabled ? "automation-rule-card" : "automation-rule-card inactive"}
                  key={rule.id}
                >
                  <div className="automation-rule-head">
                    <div>
                      <strong>{meta.title}</strong>
                      <span>{meta.description}</span>
                    </div>
                    <label className="switch-control">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(event) =>
                          void updateRule(rule, { enabled: event.target.checked })
                        }
                      />
                      <i />
                    </label>
                  </div>

                  {meta.mode === "days" && (
                    <label className="automation-inline-field">
                      Avisar com
                      <input
                        type="number"
                        min="0"
                        max="90"
                        value={rule.days_before}
                        onChange={(event) =>
                          void updateRule(rule, {
                            days_before: Math.max(0, Math.min(90, Number(event.target.value))),
                          })
                        }
                      />
                      dia(s) de antecedência
                    </label>
                  )}

                  {meta.mode === "projection" && (
                    <div className="automation-projection-fields">
                      <label>
                        Horizonte
                        <div>
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={rule.horizon_days}
                            onChange={(event) =>
                              void updateRule(rule, {
                                horizon_days: Math.max(
                                  1,
                                  Math.min(365, Number(event.target.value)),
                                ),
                              })
                            }
                          />
                          <span>dias</span>
                        </div>
                      </label>
                      <label>
                        Limite mínimo
                        <input
                          value={String(rule.threshold)}
                          onChange={(event) =>
                            void updateRule(rule, {
                              threshold: Number(event.target.value.replace(",", ".")) || 0,
                            })
                          }
                          inputMode="decimal"
                        />
                      </label>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="form-actions">
            <button className="primary" onClick={() => void saveSettings()}>
              Aplicar e recalcular
            </button>
          </div>
        </section>
      )}

      {error && <div className="form-alert error page-alert">{error}</div>}

      <section className="panel alert-toolbar">
        <div className="filter-tabs">
          {(
            [
              ["all", "Todos"],
              ["unread", "Não lidos"],
              ["critical", "Críticos"],
              ["warning", "Atenção"],
              ["info", "Informativos"],
            ] as Array<[typeof filter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "filter-tab active" : "filter-tab"}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="alert-toolbar-actions">
          <label className="dismissed-toggle">
            <input
              type="checkbox"
              checked={includeDismissed}
              onChange={(event) => setIncludeDismissed(event.target.checked)}
            />
            Mostrar dispensados
          </label>
          <button className="alert-text-action alert-mark-all" onClick={() => void markAllRead()}>
            Marcar todos como lidos
          </button>
        </div>
      </section>

      {loading ? (
        <section className="panel empty-state">Analisando sua operação financeira...</section>
      ) : filteredAlerts.length === 0 ? (
        <section className="panel empty-state">
          <strong>Nenhum alerta nesta visão.</strong>
          <span>O radar financeiro está limpo por aqui.</span>
        </section>
      ) : (
        <section className="alert-list">
          {filteredAlerts.map((item) => (
            <article
              className={
                "alert-card " +
                item.severity +
                (item.is_read ? " read" : "") +
                (item.is_dismissed ? " dismissed" : "")
              }
              key={item.id}
            >
              <div className="alert-card-content">
                <div className="alert-card-heading">
                  <div>
                    <span className={"alert-severity-label " + item.severity}>
                      {severityLabels[item.severity]}
                    </span>
                    {!item.is_read && <span className="alert-new-badge">Novo</span>}
                  </div>
                  {item.reference_date && (
                    <time>
                      {new Date(item.reference_date + "T12:00:00").toLocaleDateString("pt-BR")}
                    </time>
                  )}
                </div>

                <h2>{item.title}</h2>
                <p>{item.message}</p>

                {item.amount !== null && (
                  <strong className="alert-amount">
                    {money.format(Number(item.amount))}
                  </strong>
                )}

                <div className="alert-card-actions">
                  {item.target_page && !item.is_dismissed && (
                    <button className="primary compact-primary" onClick={() => void openAlert(item)}>
                      Abrir módulo
                    </button>
                  )}
                  {!item.is_dismissed && (
                    <button
                      className="ghost compact-button"
                      onClick={() => void setState(item, item.is_read ? "unread" : "read")}
                    >
                      {item.is_read ? "Marcar como não lido" : "Marcar como lido"}
                    </button>
                  )}
                  <button
                    className="alert-text-action alert-dismiss-action"
                    onClick={() =>
                      void setState(item, item.is_dismissed ? "restore" : "dismiss")
                    }
                  >
                    {item.is_dismissed ? "Restaurar" : "Dispensar"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
