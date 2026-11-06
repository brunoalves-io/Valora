import { useEffect, useMemo, useState } from "react";
import { StatusIcon } from "./StatusIcon";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type DashboardNavTarget = "planning" | "reports" | "alerts" | "ai";

type FinancialAccount = {
  id: string;
  name: string;
  kind: string;
  opening_balance: number | string;
  realized_net: number | string;
  estimated_balance: number | string;
};

type MonthlyTrendItem = {
  month: string;
  income: number | string;
  expense: number | string;
  result: number | string;
};

type UpcomingItem = {
  type: "income" | "expense";
  description: string;
  due_date: string;
  amount: number | string;
  partner: string | null;
};

type FinancialAlert = {
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  reference_date: string | null;
  amount: number | string | null;
};

type FinancialContext = {
  cash?: {
    opening_balance?: number | string;
    realized_net_all_time?: number | string;
    current_balance?: number | string;
  };
  current_month_realized?: {
    income?: number | string;
    expense?: number | string;
    result?: number | string;
  };
  overdue?: {
    receivable_amount?: number | string;
    receivable_count?: number;
    payable_amount?: number | string;
    payable_count?: number;
  };
  next_30_days?: {
    receivable?: number | string;
    payable?: number | string;
    net?: number | string;
    projected_balance?: number | string;
  };
  alerts?: {
    active_count?: number;
    critical_count?: number;
    items?: FinancialAlert[];
  };
  monthly_realized_trend?: MonthlyTrendItem[];
  upcoming_30_days?: UpcomingItem[];
  accounts?: FinancialAccount[];
};

type PlanningBudget = {
  id: string;
  scope: "category" | "cost_center";
  name: string;
  amount: number | string;
  alert_percent: number;
  realized: number | string;
  pending: number | string;
  committed: number | string;
  remaining: number | string;
  usage_ratio: number | string;
};

type PlanningGoal = {
  id: string;
  kind: "revenue" | "expense" | "cash";
  amount: number | string;
  current_value: number | string;
  projected_value: number | string;
  current_ratio: number | string;
  projected_ratio: number | string;
  on_track: boolean;
};

type PlanningContext = {
  period_start?: string;
  budgets?: PlanningBudget[];
  goals?: PlanningGoal[];
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const compactMoney = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 0,
});

const goalLabels: Record<PlanningGoal["kind"], string> = {
  revenue: "Receita",
  expense: "Despesas",
  cash: "Saldo mínimo",
};

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Sem data";
  return new Date(value + "T12:00:00").toLocaleDateString("pt-BR");
}

function monthShort(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1, 12)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "");
}

function DashboardMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "neutral" | "positive" | "negative" | "warning";
}) {
  return (
    <article className={"metric-card executive-metric " + tone}>
      <span>{label}</span>
      <strong>{money.format(value)}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function Dashboard({
  onNavigate,
}: {
  onNavigate: (target: DashboardNavTarget) => void;
}) {
  const { activeCompany } = useCompany();
  const [financial, setFinancial] = useState<FinancialContext>({});
  const [planning, setPlanning] = useState<PlanningContext>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiInsight, setAiInsight] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  async function load() {
    if (!supabase || !activeCompany) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const [financialResult, planningResult] = await Promise.all([
      supabase.rpc("get_ai_operational_context", {
        p_company_id: activeCompany.id,
      }),
      supabase.rpc("get_financial_planning_context", {
        p_company_id: activeCompany.id,
      }),
    ]);

    if (financialResult.error || planningResult.error) {
      setError(
        financialResult.error?.message ||
          planningResult.error?.message ||
          "Não foi possível montar o painel executivo.",
      );
    } else {
      setFinancial((financialResult.data ?? {}) as FinancialContext);
      setPlanning((planningResult.data ?? {}) as PlanningContext);
    }

    setLoading(false);
  }

  useEffect(() => {
    setAiInsight("");
    setAiError("");
    void load();
  }, [activeCompany?.id]);

  const executive = useMemo(() => {
    const accounts = financial.accounts ?? [];
    const currentBalance =
      accounts.length > 0
        ? accounts.reduce(
            (sum, account) => sum + numberValue(account.estimated_balance),
            0,
          )
        : numberValue(financial.cash?.current_balance);

    const monthIncome = numberValue(financial.current_month_realized?.income);
    const monthExpense = numberValue(financial.current_month_realized?.expense);
    const monthResult = numberValue(financial.current_month_realized?.result);

    const receivable30 = numberValue(financial.next_30_days?.receivable);
    const payable30 = numberValue(financial.next_30_days?.payable);
    const net30 = receivable30 - payable30;
    const projected30 = currentBalance + net30;

    const overdueReceivable = numberValue(financial.overdue?.receivable_amount);
    const overduePayable = numberValue(financial.overdue?.payable_amount);

    const budgets = planning.budgets ?? [];
    const goals = planning.goals ?? [];
    const alerts = financial.alerts?.items ?? [];
    const criticalAlerts = financial.alerts?.critical_count ?? 0;

    const budgetRows = budgets
      .map((item) => {
        const amount = numberValue(item.amount);
        const committed = numberValue(item.committed);
        const ratio =
          numberValue(item.usage_ratio) ||
          (amount > 0 ? committed / amount : 0);

        return {
          ...item,
          amount,
          committed,
          remaining: numberValue(item.remaining),
          ratio,
          status:
            committed >= amount
              ? ("exceeded" as const)
              : ratio >= numberValue(item.alert_percent) / 100
                ? ("warning" as const)
                : ("healthy" as const),
        };
      })
      .sort((a, b) => b.ratio - a.ratio);

    const budgetRisk = budgetRows.filter((item) => item.status !== "healthy");
    const exceededBudgets = budgetRows.filter((item) => item.status === "exceeded");

    const goalRows = goals.map((goal) => ({
      ...goal,
      target: numberValue(goal.amount),
      current: numberValue(goal.current_value),
      projected: numberValue(goal.projected_value),
      ratio: numberValue(goal.projected_ratio),
    }));

    const offTrackGoals = goalRows.filter((goal) => !goal.on_track);

    const riskLevel =
      projected30 < 0 || criticalAlerts > 0 || exceededBudgets.length > 0
        ? "critical"
        : budgetRisk.length > 0 ||
            offTrackGoals.length > 0 ||
            overduePayable > 0 ||
            projected30 < Math.max(100, currentBalance * 0.15)
          ? "warning"
          : "healthy";

    const insights: Array<{ tone: "good" | "warn" | "bad"; text: string }> = [];

    if (projected30 < 0) {
      insights.push({
        tone: "bad",
        text: `O caixa projetado para 30 dias fica negativo em ${money.format(projected30)}.`,
      });
    } else if (net30 < 0) {
      insights.push({
        tone: "warn",
        text: `Os próximos 30 dias consomem ${money.format(Math.abs(net30))} de caixa líquido.`,
      });
    } else {
      insights.push({
        tone: "good",
        text: `O fluxo previsto para 30 dias adiciona ${money.format(net30)} ao caixa.`,
      });
    }

    if (monthResult < 0) {
      insights.push({
        tone: "bad",
        text: `O mês está com resultado realizado negativo de ${money.format(Math.abs(monthResult))}.`,
      });
    } else {
      insights.push({
        tone: "good",
        text: `O resultado realizado do mês está positivo em ${money.format(monthResult)}.`,
      });
    }

    if (exceededBudgets[0]) {
      insights.push({
        tone: "bad",
        text: `${exceededBudgets[0].name} já ultrapassou o orçamento mensal em ${money.format(
          Math.abs(exceededBudgets[0].remaining),
        )}.`,
      });
    } else if (budgetRisk[0]) {
      insights.push({
        tone: "warn",
        text: `${budgetRisk[0].name} já comprometeu ${percent.format(
          budgetRisk[0].ratio,
        )} do orçamento.`,
      });
    } else if (budgetRows.length > 0) {
      insights.push({
        tone: "good",
        text: "Os orçamentos cadastrados estão dentro dos limites configurados.",
      });
    } else {
      insights.push({
        tone: "warn",
        text: "Ainda não há orçamento mensal cadastrado para acompanhar desvios.",
      });
    }

    if (overduePayable > 0 || overdueReceivable > 0) {
      insights.push({
        tone: overduePayable > 0 ? "warn" : "good",
        text: `Há ${money.format(overduePayable)} a pagar e ${money.format(
          overdueReceivable,
        )} a receber em atraso.`,
      });
    }

    return {
      currentBalance,
      monthIncome,
      monthExpense,
      monthResult,
      receivable30,
      payable30,
      net30,
      projected30,
      overdueReceivable,
      overduePayable,
      budgetRows,
      budgetRisk,
      exceededBudgets,
      goalRows,
      offTrackGoals,
      alerts,
      criticalAlerts,
      riskLevel,
      insights: insights.slice(0, 4),
    };
  }, [financial, planning]);

  const trend = useMemo(() => {
    const items = (financial.monthly_realized_trend ?? []).slice(-6).map((item) => ({
      month: item.month,
      income: numberValue(item.income),
      expense: numberValue(item.expense),
      result: numberValue(item.result),
    }));

    const max = Math.max(
      1,
      ...items.flatMap((item) => [item.income, item.expense]),
    );

    return { items, max };
  }, [financial.monthly_realized_trend]);

  const upcoming = useMemo(
    () =>
      (financial.upcoming_30_days ?? [])
        .slice()
        .sort(
          (a, b) =>
            a.due_date.localeCompare(b.due_date) ||
            numberValue(b.amount) - numberValue(a.amount),
        )
        .slice(0, 5),
    [financial.upcoming_30_days],
  );

  const priorityAlerts = useMemo(
    () =>
      executive.alerts
        .slice()
        .sort((a, b) => {
          const weight = { critical: 0, warning: 1, info: 2 };
          return weight[a.severity] - weight[b.severity];
        })
        .slice(0, 4),
    [executive.alerts],
  );

  async function generateAIInsight() {
    if (!supabase || !activeCompany || aiLoading) return;

    setAiLoading(true);
    setAiError("");

    const { data, error: invokeError } = await supabase.functions.invoke("valora-ai", {
      body: {
        companyId: activeCompany.id,
        today: localToday(),
        messages: [
          {
            role: "user",
            content:
              "Faça uma leitura executiva do momento financeiro da empresa em no máximo 4 pontos curtos. Foque em caixa atual e próximos 30 dias, resultado do mês, orçamentos/metas e a principal prioridade do gestor. Não crie nem proponha lançamentos. Não use markdown complexo; seja direto.",
          },
        ],
      },
    });

    if (invokeError || !data?.answer) {
      setAiError(
        invokeError?.message ||
          data?.error ||
          "A Valora IA não conseguiu gerar a leitura executiva agora.",
      );
    } else {
      setAiInsight(String(data.answer));
    }

    setAiLoading(false);
  }

  const statusCopy =
    executive.riskLevel === "critical"
      ? {
          title: "Atenção executiva necessária",
          text: "Há pelo menos um indicador crítico de caixa, orçamento ou alerta financeiro.",
        }
      : executive.riskLevel === "warning"
        ? {
            title: "Operação sob atenção",
            text: "O negócio segue operando, mas alguns indicadores pedem acompanhamento próximo.",
          }
        : {
            title: "Operação financeiramente estável",
            text: "Os principais indicadores estão dentro dos parâmetros atuais.",
          };

  return (
    <>
      <header className="page-header split executive-dashboard-header">
        <div>
          <p className="eyebrow">DASHBOARD EXECUTIVO</p>
          <h1>{activeCompany?.name}</h1>
          <p>Caixa, desempenho, riscos e planejamento em uma única visão de decisão.</p>
        </div>
        <div className="header-actions executive-header-actions">
          <button className="ghost" onClick={() => onNavigate("planning")}>
            Planejamento
          </button>
          <button className="primary" onClick={() => onNavigate("ai")}>
            ✦ Abrir Valora IA
          </button>
        </div>
      </header>

      {error && <div className="form-alert error page-alert">{error}</div>}

      {loading ? (
        <section className="panel empty-state">Montando visão executiva...</section>
      ) : (
        <>
          <section className={"executive-status-banner " + executive.riskLevel}>
            <span className="executive-status-icon" aria-hidden="true">
              <StatusIcon kind={executive.riskLevel === "healthy" ? "check" : "attention"} />
            </span>
            <div>
              <strong>{statusCopy.title}</strong>
              <span>{statusCopy.text}</span>
            </div>
            <button type="button" onClick={() => onNavigate("alerts")}>
              Ver radar financeiro →
            </button>
          </section>

          <section className="metrics executive-metrics">
            <DashboardMetric
              label="Saldo atual"
              value={executive.currentBalance}
              detail="Contas ativas e movimentações realizadas"
              tone={executive.currentBalance < 0 ? "negative" : "positive"}
            />
            <DashboardMetric
              label="Resultado do mês"
              value={executive.monthResult}
              detail={`Receitas ${compactMoney.format(executive.monthIncome)} · Despesas ${compactMoney.format(
                executive.monthExpense,
              )}`}
              tone={executive.monthResult < 0 ? "negative" : "positive"}
            />
            <DashboardMetric
              label="Saldo projetado em 30 dias"
              value={executive.projected30}
              detail={`Fluxo líquido previsto: ${money.format(executive.net30)}`}
              tone={executive.projected30 < 0 ? "negative" : executive.net30 < 0 ? "warning" : "positive"}
            />
            <article
              className={
                "metric-card executive-metric " +
                (executive.budgetRisk.length > 0 ? "warning" : "positive")
              }
            >
              <span>Planejamento em risco</span>
              <strong>{executive.budgetRisk.length + executive.offTrackGoals.length}</strong>
              <small>
                {executive.budgetRisk.length} orçamento(s) · {executive.offTrackGoals.length} meta(s)
              </small>
            </article>
          </section>

          <section className="executive-dashboard-grid">
            <article className="panel executive-trend-panel">
              <div className="panel-title executive-panel-title">
                <div>
                  <span className="executive-kicker">DESEMPENHO</span>
                  <h2>Receitas × despesas</h2>
                  <p>Realizado em regime de caixa nos últimos 6 meses.</p>
                </div>
                <button className="table-action" type="button" onClick={() => onNavigate("reports")}>
                  Ver relatórios
                </button>
              </div>

              {trend.items.length === 0 ? (
                <div className="empty-inline">Ainda não há histórico suficiente para o gráfico.</div>
              ) : (
                <>
                  <div className="executive-chart-legend">
                    <span><i className="income" /> Receitas</span>
                    <span><i className="expense" /> Despesas</span>
                  </div>
                  <div className="executive-bars-chart">
                    {trend.items.map((item) => (
                      <div className="executive-bars-column" key={item.month} role="img"
                        aria-label={`${monthShort(item.month)}: receitas ${money.format(item.income)}, despesas ${money.format(item.expense)}, resultado ${money.format(item.result)}`}>
                        <div className="executive-bars-area">
                          <div
                            className="executive-bar income"
                            style={{ height: `${Math.max(3, (item.income / trend.max) * 100)}%` }}
                            title={`Receitas: ${money.format(item.income)}`}
                          />
                          <div
                            className="executive-bar expense"
                            style={{ height: `${Math.max(3, (item.expense / trend.max) * 100)}%` }}
                            title={`Despesas: ${money.format(item.expense)}`}
                          />
                        </div>
                        <strong className={item.result < 0 ? "negative-value" : "positive-value"}>
                          {compactMoney.format(item.result)}
                        </strong>
                        <span>{monthShort(item.month)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </article>

            <article className="panel executive-cash-panel">
              <div className="panel-title executive-panel-title">
                <div>
                  <span className="executive-kicker">PRÓXIMOS 30 DIAS</span>
                  <h2>Pressão sobre o caixa</h2>
                  <p>Entradas e saídas já previstas.</p>
                </div>
              </div>

              <div className="executive-cash-hero">
                <span>Saldo após compromissos</span>
                <strong className={executive.projected30 < 0 ? "negative-value" : ""}>
                  {money.format(executive.projected30)}
                </strong>
                <small>
                  {executive.net30 >= 0 ? "+" : ""}
                  {money.format(executive.net30)} de variação
                </small>
              </div>

              <div className="executive-cash-flow">
                <div>
                  <span>A receber</span>
                  <strong className="positive-value">{money.format(executive.receivable30)}</strong>
                </div>
                <div>
                  <span>A pagar</span>
                  <strong className="negative-value">{money.format(executive.payable30)}</strong>
                </div>
              </div>

              <div className="executive-overdue-box">
                <span>Em atraso</span>
                <div>
                  <small>Receber</small>
                  <strong>{money.format(executive.overdueReceivable)}</strong>
                </div>
                <div>
                  <small>Pagar</small>
                  <strong>{money.format(executive.overduePayable)}</strong>
                </div>
              </div>

              <button className="executive-text-link" type="button" onClick={() => onNavigate("reports")}>
                Abrir projeção completa →
              </button>
            </article>

            <article className="panel executive-planning-panel">
              <div className="panel-title executive-panel-title">
                <div>
                  <span className="executive-kicker">PLANEJAMENTO</span>
                  <h2>Orçamentos mais pressionados</h2>
                  <p>Consumo realizado + compromissos previstos do mês.</p>
                </div>
                <button className="table-action" type="button" onClick={() => onNavigate("planning")}>
                  Gerenciar
                </button>
              </div>

              {executive.budgetRows.length === 0 ? (
                <div className="executive-empty-action">
                  <span>Nenhum orçamento mensal cadastrado.</span>
                  <button type="button" onClick={() => onNavigate("planning")}>
                    Criar orçamento
                  </button>
                </div>
              ) : (
                <div className="executive-budget-list">
                  {executive.budgetRows.slice(0, 4).map((item) => (
                    <div className={"executive-budget-item " + item.status} key={item.id}>
                      <div className="executive-budget-head">
                        <div>
                          <strong>{item.name}</strong>
                          <span>
                            {money.format(item.committed)} de {money.format(item.amount)}
                          </span>
                        </div>
                        <b>{percent.format(item.ratio)}</b>
                      </div>
                      <div className="executive-progress">
                        <i style={{ width: `${Math.min(100, Math.max(0, item.ratio * 100))}%` }} />
                      </div>
                      <small>
                        {item.remaining >= 0
                          ? `${money.format(item.remaining)} ainda disponível`
                          : `${money.format(Math.abs(item.remaining))} acima do limite`}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel executive-goals-panel">
              <div className="panel-title executive-panel-title">
                <div>
                  <span className="executive-kicker">METAS</span>
                  <h2>Objetivos do mês</h2>
                  <p>Realizado e projeção contra o plano.</p>
                </div>
              </div>

              {executive.goalRows.length === 0 ? (
                <div className="executive-empty-action">
                  <span>Nenhuma meta mensal definida.</span>
                  <button type="button" onClick={() => onNavigate("planning")}>
                    Definir metas
                  </button>
                </div>
              ) : (
                <div className="executive-goal-list">
                  {executive.goalRows.map((goal) => (
                    <div className={goal.on_track ? "executive-goal-item healthy" : "executive-goal-item warning"} key={goal.id}>
                      <div>
                        <span>{goalLabels[goal.kind]}</span>
                        <strong>{money.format(goal.target)}</strong>
                      </div>
                      <div className="executive-goal-right">
                        <b>{goal.on_track ? "No plano" : "Atenção"}</b>
                        <small>Projeção {money.format(goal.projected)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel executive-alerts-panel">
              <div className="panel-title executive-panel-title">
                <div>
                  <span className="executive-kicker">RADAR</span>
                  <h2>Alertas prioritários</h2>
                  <p>O que merece atenção agora.</p>
                </div>
                <button className="table-action" type="button" onClick={() => onNavigate("alerts")}>
                  Ver todos
                </button>
              </div>

              {priorityAlerts.length === 0 ? (
                <div className="executive-radar-clear">
                  <i>✓</i>
                  <div>
                    <strong>Nenhum alerta prioritário.</strong>
                    <span>O radar financeiro está limpo neste momento.</span>
                  </div>
                </div>
              ) : (
                <div className="executive-alert-list">
                  {priorityAlerts.map((alert, index) => (
                    <div className={"executive-alert-item " + alert.severity} key={`${alert.title}-${index}`}>
                      <i />
                      <div>
                        <strong>{alert.title}</strong>
                        <span>{alert.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel executive-upcoming-panel">
              <div className="panel-title executive-panel-title">
                <div>
                  <span className="executive-kicker">AGENDA FINANCEIRA</span>
                  <h2>Próximos impactos</h2>
                  <p>Lançamentos pendentes mais próximos.</p>
                </div>
              </div>

              {upcoming.length === 0 ? (
                <div className="empty-inline">Nenhum impacto previsto nos próximos 30 dias.</div>
              ) : (
                <div className="executive-upcoming-list">
                  {upcoming.map((item, index) => (
                    <div className="executive-upcoming-item" key={`${item.due_date}-${item.description}-${index}`}>
                      <span className={"executive-flow-icon " + item.type}>
                        {item.type === "income" ? "↑" : "↓"}
                      </span>
                      <div>
                        <strong>{item.description}</strong>
                        <small>
                          {formatDate(item.due_date)}
                          {item.partner ? ` · ${item.partner}` : ""}
                        </small>
                      </div>
                      <b className={item.type === "income" ? "positive-value" : "negative-value"}>
                        {item.type === "income" ? "+" : "-"}
                        {money.format(numberValue(item.amount))}
                      </b>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel executive-insights-panel">
              <div className="executive-insights-copy">
                <span className="executive-kicker light">LEITURA EXECUTIVA</span>
                <h2>O que os números estão dizendo</h2>
                <p>
                  Sinais automáticos extraídos do caixa, desempenho e planejamento atual.
                </p>
                <div className="executive-insight-list">
                  {executive.insights.map((insight, index) => (
                    <div className={"executive-insight-item " + insight.tone} key={index}>
                      <i />
                      <span>{insight.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="executive-ai-box">
                <div className="executive-ai-box-head">
                  <span>✦</span>
                  <div>
                    <strong>Valora IA</strong>
                    <small>Análise executiva sob demanda</small>
                  </div>
                </div>

                {aiInsight ? (
                  <div className="executive-ai-answer">{aiInsight}</div>
                ) : (
                  <p>
                    Gere uma leitura curta combinando caixa, projeção, orçamento, metas e riscos.
                  </p>
                )}

                {aiError && <span className="executive-ai-error">{aiError}</span>}

                <div className="executive-ai-actions">
                  <button
                    className="executive-ai-generate"
                    type="button"
                    onClick={() => void generateAIInsight()}
                    disabled={aiLoading}
                  >
                    {aiLoading ? "Analisando..." : aiInsight ? "Atualizar análise" : "Gerar análise com IA"}
                  </button>
                  <button type="button" className="executive-ai-open" onClick={() => onNavigate("ai")}>
                    Conversar →
                  </button>
                </div>
              </div>
            </article>
          </section>
        </>
      )}
    </>
  );
}
