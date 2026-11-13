import { useEffect, useMemo, useState } from "react";
import { StatusIcon } from "./StatusIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type DreSnapshot = {
  revenue?: number | string;
  taxes?: number | string;
  net_revenue?: number | string;
  costs?: number | string;
  gross_profit?: number | string;
  operating_expenses?: number | string;
  operating_result?: number | string;
  other_income?: number | string;
  other_expenses?: number | string;
  net_result?: number | string;
  gross_margin?: number | string;
  operating_margin?: number | string;
  net_margin?: number | string;
};

type BudgetSnapshot = {
  id: string;
  scope: "category" | "cost_center";
  name: string;
  amount: number | string;
  alert_percent: number;
  realized: number | string;
  pending_at_close: number | string;
  committed: number | string;
  remaining: number | string;
  usage_ratio: number | string;
  status: "healthy" | "warning" | "exceeded";
};

type GoalSnapshot = {
  id: string;
  kind: "revenue" | "expense" | "cash";
  amount: number | string;
  actual_value: number | string;
  achievement_ratio: number | string;
  achieved: boolean;
};

type BreakdownItem = {
  name: string;
  income: number | string;
  expense: number | string;
  result: number | string;
};

type CloseSnapshot = {
  company_id?: string;
  period_start: string;
  period_end: string;
  is_complete_period: boolean;
  income: number | string;
  expense: number | string;
  result: number | string;
  margin: number | string;
  ending_balance: number | string;
  overdue_receivable: number | string;
  overdue_payable: number | string;
  budget_amount: number | string;
  budget_committed: number | string;
  budget_variance: number | string;
  goals_total: number;
  goals_achieved: number;
  goals_rate: number | string;
  dre?: DreSnapshot;
  budgets?: BudgetSnapshot[];
  goals?: GoalSnapshot[];
  categories?: BreakdownItem[];
  cost_centers?: BreakdownItem[];
  top_expense_category?: {
    name?: string;
    amount?: number | string;
  } | null;
};

type MonthlyClosing = {
  id: string;
  company_id: string;
  period_start: string;
  period_end: string;
  income: number | string;
  expense: number | string;
  result: number | string;
  margin: number | string;
  ending_balance: number | string;
  overdue_receivable: number | string;
  overdue_payable: number | string;
  budget_amount: number | string;
  budget_committed: number | string;
  goals_total: number;
  goals_achieved: number;
  snapshot: CloseSnapshot;
  ai_summary: string | null;
  revision: number;
  closed_at: string;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const compactMoney = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const goalLabels: Record<GoalSnapshot["kind"], string> = {
  revenue: "Meta de receita",
  expense: "Limite de despesas",
  cash: "Saldo mínimo",
};

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function previousMonthValue() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function periodStart(month: string) {
  return `${month}-01`;
}

function monthLabel(value: string) {
  const key = value.slice(0, 7);
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1, 12)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, (char) => char.toUpperCase());
}

function shortMonth(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(year, month - 1, 1, 12)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function variation(current: number, previous: number) {
  if (Math.abs(previous) < 0.009) return null;
  return (current - previous) / Math.abs(previous);
}

function variationCopy(current: number, previous: number) {
  const value = variation(current, previous);
  if (value === null) return "Sem base comparável";
  const sign = value > 0 ? "+" : "";
  return `${sign}${percent.format(value)} vs. fechamento anterior`;
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return '"' + text.replace(/"/g, '""') + '"';
}

export function MonthlyClosingPage() {
  const { activeCompany, activeRole } = useCompany();
  const [month, setMonth] = useState(previousMonthValue());
  const [preview, setPreview] = useState<CloseSnapshot | null>(null);
  const [closings, setClosings] = useState<MonthlyClosing[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [error, setError] = useState("");
  const [pendingClose, setPendingClose] = useState(false);

  const canManage = activeRole !== "viewer";
  const selectedStart = periodStart(month);

  async function load() {
    if (!supabase || !activeCompany) return;

    setLoading(true);
    setError("");

    const [previewResult, closingResult] = await Promise.all([
      supabase.rpc("get_monthly_close_preview", {
        p_company_id: activeCompany.id,
        p_period_start: selectedStart,
      }),
      supabase
        .from("monthly_financial_closings")
        .select(
          "id, company_id, period_start, period_end, income, expense, result, margin, ending_balance, overdue_receivable, overdue_payable, budget_amount, budget_committed, goals_total, goals_achieved, snapshot, ai_summary, revision, closed_at",
        )
        .eq("company_id", activeCompany.id)
        .order("period_start", { ascending: false })
        .limit(24),
    ]);

    if (previewResult.error || closingResult.error) {
      setError(
        previewResult.error?.message ||
          closingResult.error?.message ||
          "Não foi possível montar o fechamento mensal.",
      );
    } else {
      setPreview((previewResult.data ?? null) as CloseSnapshot | null);
      setClosings((closingResult.data ?? []) as MonthlyClosing[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id, month]);

  const selectedClosing = useMemo(
    () => closings.find((item) => item.period_start === selectedStart) ?? null,
    [closings, selectedStart],
  );

  const displayed = selectedClosing?.snapshot ?? preview;

  const previousClosing = useMemo(
    () =>
      closings
        .filter((item) => item.period_start < selectedStart)
        .sort((a, b) => b.period_start.localeCompare(a.period_start))[0] ?? null,
    [closings, selectedStart],
  );

  const history = useMemo(
    () =>
      closings
        .slice()
        .sort((a, b) => a.period_start.localeCompare(b.period_start))
        .slice(-12),
    [closings],
  );

  const historyScale = useMemo(
    () =>
      Math.max(
        1,
        ...history.flatMap((item) => [
          Math.abs(numberValue(item.income)),
          Math.abs(numberValue(item.expense)),
        ]),
      ),
    [history],
  );

  const dreRows = useMemo(() => {
    const dre = displayed?.dre ?? {};
    return [
      ["(+) Receita bruta", numberValue(dre.revenue), "line"],
      ["(−) Impostos e deduções", numberValue(dre.taxes), "line"],
      ["Receita líquida", numberValue(dre.net_revenue), "subtotal"],
      ["(−) Custos diretos", numberValue(dre.costs), "line"],
      ["Lucro bruto", numberValue(dre.gross_profit), "subtotal"],
      ["(−) Despesas operacionais", numberValue(dre.operating_expenses), "line"],
      ["Resultado operacional", numberValue(dre.operating_result), "subtotal"],
      ["(+) Outras receitas", numberValue(dre.other_income), "line"],
      ["(−) Outras despesas", numberValue(dre.other_expenses), "line"],
      ["Resultado líquido", numberValue(dre.net_result), "total"],
    ] as Array<[string, number, "line" | "subtotal" | "total"]>;
  }, [displayed]);

  const topBudgets = useMemo(
    () =>
      (displayed?.budgets ?? [])
        .slice()
        .sort(
          (a, b) =>
            numberValue(b.usage_ratio) - numberValue(a.usage_ratio),
        )
        .slice(0, 5),
    [displayed],
  );

  const topCategories = useMemo(
    () =>
      (displayed?.categories ?? [])
        .filter((item) => numberValue(item.expense) > 0)
        .slice()
        .sort(
          (a, b) => numberValue(b.expense) - numberValue(a.expense),
        )
        .slice(0, 5),
    [displayed],
  );

  async function closeMonth() {
    if (!supabase || !activeCompany || !canManage || closing) return;

    setClosing(true);
    setError("");

    const { error: closeError } = await supabase.rpc(
      "close_monthly_financial_period",
      {
        p_company_id: activeCompany.id,
        p_period_start: selectedStart,
      },
    );

    if (closeError) {
      setError(
        closeError.message.includes("Only completed months")
          ? "O mês atual ainda está em andamento. Ele pode ser acompanhado como prévia, mas só pode ser fechado depois de terminar."
          : closeError.message,
      );
    } else {
      setPendingClose(false);
      await load();
    }

    setClosing(false);
  }

  async function generateAISummary() {
    if (
      !supabase ||
      !activeCompany ||
      !selectedClosing ||
      generatingAI ||
      !canManage
    ) {
      return;
    }

    setGeneratingAI(true);
    setError("");

    const previousSnapshot = previousClosing?.snapshot ?? null;
    const { data, error: invokeError } = await supabase.functions.invoke(
      "valora-ai",
      {
        body: {
          companyId: activeCompany.id,
          mode: "monthly_close_summary",
          today: localIso(new Date()),
          monthlyClose: {
            company_name: activeCompany.name,
            closing: selectedClosing.snapshot,
            previous_closing: previousSnapshot,
          },
        },
      },
    );

    if (invokeError || !data?.answer) {
      setError(
        invokeError?.message ||
          data?.error ||
          "A Valora IA não conseguiu gerar o resumo deste fechamento.",
      );
      setGeneratingAI(false);
      return;
    }

    const summary = String(data.answer).trim();
    const { error: saveError } = await supabase
      .from("monthly_financial_closings")
      .update({
        ai_summary: summary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedClosing.id)
      .eq("company_id", activeCompany.id);

    if (saveError) {
      setError(saveError.message);
    } else {
      setClosings((current) =>
        current.map((item) =>
          item.id === selectedClosing.id
            ? { ...item, ai_summary: summary }
            : item,
        ),
      );
    }

    setGeneratingAI(false);
  }

  function exportCsv() {
    if (!displayed) return;

    const rows: Array<Array<string | number>> = [
      ["Fechamento mensal Valora", monthLabel(displayed.period_start)],
      [],
      ["Indicador", "Valor"],
      ["Receitas realizadas", numberValue(displayed.income).toFixed(2).replace(".", ",")],
      ["Despesas realizadas", numberValue(displayed.expense).toFixed(2).replace(".", ",")],
      ["Resultado", numberValue(displayed.result).toFixed(2).replace(".", ",")],
      ["Margem", percent.format(numberValue(displayed.margin))],
      ["Saldo final", numberValue(displayed.ending_balance).toFixed(2).replace(".", ",")],
      ["A receber em atraso no fim do mês", numberValue(displayed.overdue_receivable).toFixed(2).replace(".", ",")],
      ["A pagar em atraso no fim do mês", numberValue(displayed.overdue_payable).toFixed(2).replace(".", ",")],
      ["Orçamento total", numberValue(displayed.budget_amount).toFixed(2).replace(".", ",")],
      ["Orçamento comprometido", numberValue(displayed.budget_committed).toFixed(2).replace(".", ",")],
      ["Metas atingidas", `${displayed.goals_achieved}/${displayed.goals_total}`],
      [],
      ["DRE", "Valor"],
      ...dreRows.map(([label, value]) => [
        label,
        value.toFixed(2).replace(".", ","),
      ]),
      [],
      ["Orçamentos", "Orçado", "Comprometido", "Disponível", "Consumo"],
      ...(displayed.budgets ?? []).map((item) => [
        item.name,
        numberValue(item.amount).toFixed(2).replace(".", ","),
        numberValue(item.committed).toFixed(2).replace(".", ","),
        numberValue(item.remaining).toFixed(2).replace(".", ","),
        percent.format(numberValue(item.usage_ratio)),
      ]),
      [],
      ["Metas", "Objetivo", "Realizado", "Atingida"],
      ...(displayed.goals ?? []).map((item) => [
        goalLabels[item.kind],
        numberValue(item.amount).toFixed(2).replace(".", ","),
        numberValue(item.actual_value).toFixed(2).replace(".", ","),
        item.achieved ? "Sim" : "Não",
      ]),
    ];

    if (selectedClosing?.ai_summary) {
      rows.push([], ["Resumo Valora IA", selectedClosing.ai_summary]);
    }

    const csv = rows
      .map((row) => row.map((cell) => csvCell(cell)).join(";"))
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `valora-fechamento-${month}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <section className="panel empty-state">
        Preparando o fechamento mensal...
      </section>
    );
  }

  if (!displayed) {
    return (
      <>
        {error && <div className="form-alert error page-alert">{error}</div>}
        <section className="panel empty-state">
          Não foi possível montar a prévia deste período.
        </section>
      </>
    );
  }

  const isCurrentMonth = month === currentMonthValue();
  const status = selectedClosing
    ? "closed"
    : displayed.is_complete_period
      ? "ready"
      : "preview";

  const previousIncome = previousClosing
    ? numberValue(previousClosing.income)
    : 0;
  const previousExpense = previousClosing
    ? numberValue(previousClosing.expense)
    : 0;
  const previousResult = previousClosing
    ? numberValue(previousClosing.result)
    : 0;

  return (
    <>
      <header className="page-header split monthly-close-header">
        <div>
          <p className="eyebrow">PERFORMANCE</p>
          <h1>Fechamento mensal</h1>
          <p>
            Congele a fotografia gerencial do mês e acompanhe a evolução da empresa ao longo do tempo.
          </p>
        </div>

        <div className="monthly-close-header-actions">
          <label className="monthly-close-month">
            <span>Competência</span>
            <input
              type="month"
              value={month}
              max={currentMonthValue()}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <button className="ghost" type="button" onClick={exportCsv}>
            Exportar CSV
          </button>
          {canManage && !isCurrentMonth && (
            <button
              className="primary"
              type="button"
              onClick={() => setPendingClose(true)}
            >
              {selectedClosing ? "Atualizar fechamento" : "Fechar mês"}
            </button>
          )}
        </div>
      </header>

      {error && <div className="form-alert error page-alert">{error}</div>}

      <section className={"monthly-close-status " + status}>
        <i aria-hidden="true">
          <StatusIcon kind={status === "closed" ? "check" : "info"} />
        </i>
        <div>
          <strong>
            {status === "closed"
              ? `${monthLabel(selectedStart)} fechado`
              : status === "ready"
                ? `${monthLabel(selectedStart)} pronto para fechamento`
                : `${monthLabel(selectedStart)} em andamento`}
          </strong>
          <span>
            {selectedClosing
              ? `Snapshot salvo em ${formatDateTime(selectedClosing.closed_at)} · revisão ${selectedClosing.revision}.`
              : status === "ready"
                ? "A prévia está pronta. Fechar o mês registra estes números no histórico de performance."
                : "Os dados abaixo são uma prévia dinâmica e continuam mudando conforme novos lançamentos são registrados."}
          </span>
        </div>
        {selectedClosing && (
          <b>FECHADO</b>
        )}
      </section>

      <section className="metrics monthly-close-metrics">
        <article className="metric-card">
          <span>Receitas realizadas</span>
          <strong className="positive-value">
            {money.format(numberValue(displayed.income))}
          </strong>
          <small>
            {previousClosing
              ? variationCopy(numberValue(displayed.income), previousIncome)
              : "Regime de caixa"}
          </small>
        </article>
        <article className="metric-card">
          <span>Despesas realizadas</span>
          <strong className="negative-value">
            {money.format(numberValue(displayed.expense))}
          </strong>
          <small>
            {previousClosing
              ? variationCopy(numberValue(displayed.expense), previousExpense)
              : "Regime de caixa"}
          </small>
        </article>
        <article className="metric-card">
          <span>Resultado do mês</span>
          <strong
            className={
              numberValue(displayed.result) < 0
                ? "negative-value"
                : "positive-value"
            }
          >
            {money.format(numberValue(displayed.result))}
          </strong>
          <small>
            {previousClosing
              ? variationCopy(numberValue(displayed.result), previousResult)
              : `Margem ${percent.format(numberValue(displayed.margin))}`}
          </small>
        </article>
        <article className="metric-card">
          <span>Saldo no fim do período</span>
          <strong
            className={
              numberValue(displayed.ending_balance) < 0
                ? "negative-value"
                : ""
            }
          >
            {money.format(numberValue(displayed.ending_balance))}
          </strong>
          <small>Contas ativas com movimentos conciliados ao saldo</small>
        </article>
      </section>

      <section className="monthly-close-grid">
        <article className="panel monthly-performance-panel">
          <div className="panel-title monthly-close-panel-title">
            <div>
              <span className="monthly-close-kicker">HISTÓRICO FECHADO</span>
              <h2>Performance mensal</h2>
              <p>Receitas, despesas e resultado dos últimos fechamentos.</p>
            </div>
            <span className="report-count">{history.length} mês(es)</span>
          </div>

          {history.length === 0 ? (
            <div className="monthly-close-empty">
              <strong>O histórico começa no primeiro fechamento.</strong>
              <span>Feche um mês concluído para iniciar a série comparativa.</span>
            </div>
          ) : (
            <>
              <div className="monthly-history-legend">
                <span><i className="income" /> Receita</span>
                <span><i className="expense" /> Despesa</span>
              </div>
              <div className="monthly-history-chart">
                {history.map((item) => {
                  const income = numberValue(item.income);
                  const expense = numberValue(item.expense);
                  const result = numberValue(item.result);
                  return (
                    <button
                      className={
                        item.period_start === selectedStart
                          ? "monthly-history-column active"
                          : "monthly-history-column"
                      }
                      type="button"
                      key={item.id}
                      onClick={() => setMonth(item.period_start.slice(0, 7))}
                    >
                      <div className="monthly-history-bars">
                        <i
                          className="income"
                          style={{
                            height: `${Math.max(3, (income / historyScale) * 100)}%`,
                          }}
                        />
                        <i
                          className="expense"
                          style={{
                            height: `${Math.max(3, (expense / historyScale) * 100)}%`,
                          }}
                        />
                      </div>
                      <strong className={result < 0 ? "negative-value" : "positive-value"}>
                        {compactMoney.format(result)}
                      </strong>
                      <span>{shortMonth(item.period_start)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </article>

        <article className="panel monthly-health-panel">
          <div className="panel-title monthly-close-panel-title">
            <div>
              <span className="monthly-close-kicker">SAÚDE FINANCEIRA</span>
              <h2>Posição no fechamento</h2>
              <p>Inadimplência, orçamento e metas.</p>
            </div>
          </div>

          <div className="monthly-health-list">
            <div>
              <span>A receber em atraso</span>
              <strong>{money.format(numberValue(displayed.overdue_receivable))}</strong>
              <small>Em aberto no último dia do mês</small>
            </div>
            <div>
              <span>A pagar em atraso</span>
              <strong
                className={
                  numberValue(displayed.overdue_payable) > 0
                    ? "negative-value"
                    : ""
                }
              >
                {money.format(numberValue(displayed.overdue_payable))}
              </strong>
              <small>Em aberto no último dia do mês</small>
            </div>
            <div>
              <span>Orçamento</span>
              <strong>
                {money.format(numberValue(displayed.budget_committed))}
              </strong>
              <small>
                de {money.format(numberValue(displayed.budget_amount))} planejados
              </small>
            </div>
            <div>
              <span>Metas atingidas</span>
              <strong>
                {displayed.goals_achieved}/{displayed.goals_total}
              </strong>
              <small>
                {displayed.goals_total > 0
                  ? percent.format(numberValue(displayed.goals_rate))
                  : "Nenhuma meta cadastrada"}
              </small>
            </div>
          </div>
        </article>

        <article className="panel monthly-dre-panel">
          <div className="panel-title monthly-close-panel-title">
            <div>
              <span className="monthly-close-kicker">DRE GERENCIAL</span>
              <h2>Resultado consolidado</h2>
              <p>Estrutura de resultado congelada no snapshot do mês.</p>
            </div>
          </div>

          <div className="monthly-dre-table">
            {dreRows.map(([label, value, kind]) => (
              <div className={"monthly-dre-row " + kind} key={label}>
                <span>{label}</span>
                <strong className={value < 0 ? "negative-value" : ""}>
                  {money.format(value)}
                </strong>
              </div>
            ))}
          </div>

          <div className="monthly-margin-strip">
            <div>
              <span>Margem bruta</span>
              <strong>{percent.format(numberValue(displayed.dre?.gross_margin))}</strong>
            </div>
            <div>
              <span>Margem operacional</span>
              <strong>{percent.format(numberValue(displayed.dre?.operating_margin))}</strong>
            </div>
            <div>
              <span>Margem líquida</span>
              <strong>{percent.format(numberValue(displayed.dre?.net_margin))}</strong>
            </div>
          </div>
        </article>

        <article className="panel monthly-budget-panel">
          <div className="panel-title monthly-close-panel-title">
            <div>
              <span className="monthly-close-kicker">PLANEJADO × REAL</span>
              <h2>Orçamentos</h2>
              <p>Limites mais pressionados ao final do mês.</p>
            </div>
          </div>

          {topBudgets.length === 0 ? (
            <div className="monthly-close-empty compact">
              <span>Nenhum orçamento cadastrado para esta competência.</span>
            </div>
          ) : (
            <div className="monthly-budget-list">
              {topBudgets.map((item) => {
                const ratio = numberValue(item.usage_ratio);
                const remaining = numberValue(item.remaining);
                return (
                  <div className={"monthly-budget-item " + item.status} key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {money.format(numberValue(item.committed))} de{" "}
                        {money.format(numberValue(item.amount))}
                      </span>
                    </div>
                    <b>{percent.format(ratio)}</b>
                    <div className="monthly-budget-progress">
                      <i style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
                    </div>
                    <small className={remaining < 0 ? "negative-value" : ""}>
                      {remaining >= 0
                        ? `${money.format(remaining)} disponível`
                        : `${money.format(Math.abs(remaining))} acima do limite`}
                    </small>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel monthly-goals-panel">
          <div className="panel-title monthly-close-panel-title">
            <div>
              <span className="monthly-close-kicker">OBJETIVOS</span>
              <h2>Metas do mês</h2>
              <p>Resultado final contra o que foi planejado.</p>
            </div>
          </div>

          {(displayed.goals ?? []).length === 0 ? (
            <div className="monthly-close-empty compact">
              <span>Nenhuma meta cadastrada para esta competência.</span>
            </div>
          ) : (
            <div className="monthly-goal-list">
              {(displayed.goals ?? []).map((goal) => (
                <div
                  className={
                    goal.achieved
                      ? "monthly-goal-item achieved"
                      : "monthly-goal-item missed"
                  }
                  key={goal.id}
                >
                  <div>
                    <span>{goalLabels[goal.kind]}</span>
                    <strong>{money.format(numberValue(goal.amount))}</strong>
                  </div>
                  <div>
                    <b>{goal.achieved ? "Atingida" : "Não atingida"}</b>
                    <small>
                      Realizado {money.format(numberValue(goal.actual_value))}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel monthly-category-panel">
          <div className="panel-title monthly-close-panel-title">
            <div>
              <span className="monthly-close-kicker">COMPOSIÇÃO</span>
              <h2>Maiores despesas</h2>
              <p>Categorias que mais consumiram recursos no mês.</p>
            </div>
          </div>

          {topCategories.length === 0 ? (
            <div className="monthly-close-empty compact">
              <span>Nenhuma despesa realizada nesta competência.</span>
            </div>
          ) : (
            <div className="monthly-category-ranking">
              {topCategories.map((item, index) => (
                <div key={item.name}>
                  <span>{index + 1}</span>
                  <strong>{item.name}</strong>
                  <b>{money.format(numberValue(item.expense))}</b>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel monthly-ai-panel">
          <div className="monthly-ai-copy">
            <span className="monthly-close-kicker light">VALORA IA</span>
            <h2>Resumo executivo do fechamento</h2>
            <p>
              Uma leitura gerencial do resultado, mudanças em relação ao mês anterior,
              orçamento, metas e prioridades para o próximo ciclo.
            </p>

            {selectedClosing?.ai_summary ? (
              <div className="monthly-ai-summary">
                {selectedClosing.ai_summary}
              </div>
            ) : selectedClosing ? (
              <div className="monthly-ai-empty">
                O mês já está fechado. Gere uma análise para registrar a leitura executiva junto ao snapshot.
              </div>
            ) : (
              <div className="monthly-ai-empty">
                Feche esta competência para habilitar o resumo executivo permanente.
              </div>
            )}
          </div>

          <div className="monthly-ai-side">
            <div>
              <span>Resultado</span>
              <strong className={numberValue(displayed.result) < 0 ? "negative-value" : "positive-value"}>
                {money.format(numberValue(displayed.result))}
              </strong>
            </div>
            <div>
              <span>Maior despesa</span>
              <strong>
                {displayed.top_expense_category?.name ?? "Sem dados"}
              </strong>
              <small>
                {displayed.top_expense_category
                  ? money.format(numberValue(displayed.top_expense_category.amount))
                  : "—"}
              </small>
            </div>

            {selectedClosing && canManage && (
              <button
                className="primary"
                type="button"
                disabled={generatingAI}
                onClick={() => void generateAISummary()}
              >
                {generatingAI
                  ? "Analisando..."
                  : selectedClosing.ai_summary
                    ? "Atualizar resumo com IA"
                    : "Gerar resumo com IA"}
              </button>
            )}
          </div>
        </article>
      </section>

      <section className="monthly-close-note">
        <strong>Fechamento gerencial</strong>
        <span>
          O fechamento cria um snapshot histórico e não bloqueia lançamentos. Se houver uma correção posterior, use “Atualizar fechamento” para gerar uma nova revisão do mês.
        </span>
      </section>

      <ConfirmDialog
        open={pendingClose}
        title={selectedClosing ? "Atualizar fechamento mensal?" : "Fechar este mês?"}
        description={
          selectedClosing
            ? `O snapshot de ${monthLabel(selectedStart)} será recalculado com os dados atuais.`
            : `O Valora registrará a fotografia gerencial de ${monthLabel(selectedStart)} no histórico de performance.`
        }
        showWarningIcon={false}
        warning={
          selectedClosing
            ? "O resumo da Valora IA será limpo para evitar manter uma análise baseada em números antigos."
            : "Nenhum lançamento será bloqueado ou alterado."
        }
        confirmLabel={selectedClosing ? "Atualizar fechamento" : "Fechar mês"}
        busyLabel={selectedClosing ? "Atualizando fechamento..." : "Fechando mês..."}
        tone="primary"
        busy={closing}
        onCancel={() => {
          if (!closing) setPendingClose(false);
        }}
        onConfirm={() => void closeMonth()}
      />
    </>
  );
}
