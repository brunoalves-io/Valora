import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type BudgetScope = "category" | "cost_center";
type GoalKind = "revenue" | "expense" | "cash";
type TransactionType = "income" | "expense";

type Category = {
  id: string;
  name: string;
  type: "income" | "expense" | "both";
  active: boolean;
};

type CostCenter = {
  id: string;
  name: string;
  active: boolean;
};

type Budget = {
  id: string;
  scope: BudgetScope;
  category_id: string | null;
  cost_center_id: string | null;
  amount: number | string;
  alert_percent: number;
  active: boolean;
};

type Goal = {
  id: string;
  kind: GoalKind;
  amount: number | string;
  active: boolean;
};

type Transaction = {
  id: string;
  type: TransactionType;
  amount: number | string;
  status: "paid" | "pending" | "cancelled";
  due_date: string;
  paid_at: string | null;
  category_id: string | null;
  cost_center_id: string | null;
  account_id: string | null;
};

type Account = {
  id: string;
  opening_balance: number | string;
  active: boolean;
};

type DeleteTarget =
  | { kind: "budget"; id: string; label: string }
  | { kind: "goal"; id: string; label: string };

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const goalLabels: Record<GoalKind, string> = {
  revenue: "Meta de receita",
  expense: "Limite de despesas",
  cash: "Meta mínima de saldo",
};

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodStart(month: string) {
  return `${month}-01`;
}

function nextMonthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(year, monthNumber, 1, 12);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
}

function periodEnd(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0, 12).toISOString().slice(0, 10);
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1, 12)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, (value) => value.toUpperCase());
}

function parseMoney(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return 0;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function PlanningPage() {
  const { activeCompany, activeRole } = useCompany();
  const [month, setMonth] = useState(currentMonthValue());
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [monthTransactions, setMonthTransactions] = useState<Transaction[]>([]);
  const [paidTransactions, setPaidTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBudget, setSavingBudget] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [budgetForm, setBudgetForm] = useState({
    scope: "category" as BudgetScope,
    targetId: "",
    amount: "",
    alertPercent: 80,
  });
  const [goalForm, setGoalForm] = useState({
    kind: "revenue" as GoalKind,
    amount: "",
  });

  const canConfigure = activeRole !== "viewer";

  async function refreshPlanningAlerts() {
    if (!supabase || !activeCompany || month !== currentMonthValue()) return;
    await supabase.rpc("refresh_financial_planning_alerts", {
      p_company_id: activeCompany.id,
    });
  }

  async function load() {
    if (!supabase || !activeCompany) return;

    setLoading(true);
    setError("");

    const start = periodStart(month);
    const end = periodEnd(month);
    const next = nextMonthStart(month);

    const [
      categoryResult,
      costCenterResult,
      budgetResult,
      goalResult,
      paidMonthResult,
      pendingMonthResult,
      accountResult,
      allPaidResult,
    ] = await Promise.all([
      supabase
        .from("categories")
        .select("id, name, type, active")
        .eq("company_id", activeCompany.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("cost_centers")
        .select("id, name, active")
        .eq("company_id", activeCompany.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("financial_budgets")
        .select("id, scope, category_id, cost_center_id, amount, alert_percent, active")
        .eq("company_id", activeCompany.id)
        .eq("period_start", start)
        .eq("active", true)
        .order("created_at"),
      supabase
        .from("financial_goals")
        .select("id, kind, amount, active")
        .eq("company_id", activeCompany.id)
        .eq("period_start", start)
        .eq("active", true)
        .order("kind"),
      supabase
        .from("transactions")
        .select("id, type, amount, status, due_date, paid_at, category_id, cost_center_id, account_id")
        .eq("company_id", activeCompany.id)
        .eq("status", "paid")
        .gte("paid_at", `${start}T00:00:00`)
        .lt("paid_at", `${next}T00:00:00`),
      supabase
        .from("transactions")
        .select("id, type, amount, status, due_date, paid_at, category_id, cost_center_id, account_id")
        .eq("company_id", activeCompany.id)
        .eq("status", "pending")
        .gte("due_date", start)
        .lte("due_date", end),
      supabase
        .from("financial_accounts")
        .select("id, opening_balance, active")
        .eq("company_id", activeCompany.id)
        .eq("active", true),
      supabase
        .from("transactions")
        .select("id, type, amount, status, due_date, paid_at, category_id, cost_center_id, account_id")
        .eq("company_id", activeCompany.id)
        .eq("status", "paid"),
    ]);

    const firstError = [
      categoryResult.error,
      costCenterResult.error,
      budgetResult.error,
      goalResult.error,
      paidMonthResult.error,
      pendingMonthResult.error,
      accountResult.error,
      allPaidResult.error,
    ].find(Boolean);

    if (firstError) {
      setError(firstError.message);
    } else {
      setCategories((categoryResult.data ?? []) as Category[]);
      setCostCenters((costCenterResult.data ?? []) as CostCenter[]);
      setBudgets((budgetResult.data ?? []) as Budget[]);
      setGoals((goalResult.data ?? []) as Goal[]);
      setMonthTransactions([
        ...((paidMonthResult.data ?? []) as Transaction[]),
        ...((pendingMonthResult.data ?? []) as Transaction[]),
      ]);
      setAccounts((accountResult.data ?? []) as Account[]);
      setPaidTransactions((allPaidResult.data ?? []) as Transaction[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    setBudgetForm({
      scope: "category",
      targetId: "",
      amount: "",
      alertPercent: 80,
    });
    setGoalForm({ kind: "revenue", amount: "" });
    void load();
  }, [activeCompany?.id, month]);

  const categoryMap = useMemo(
    () => new Map(categories.map((item) => [item.id, item.name])),
    [categories],
  );

  const costCenterMap = useMemo(
    () => new Map(costCenters.map((item) => [item.id, item.name])),
    [costCenters],
  );

  const budgetRows = useMemo(() => {
    return budgets
      .map((budget) => {
        const relevant = monthTransactions.filter((item) => {
          if (item.type !== "expense") return false;
          if (budget.scope === "category") return item.category_id === budget.category_id;
          return item.cost_center_id === budget.cost_center_id;
        });

        const realized = relevant
          .filter((item) => item.status === "paid")
          .reduce((sum, item) => sum + Number(item.amount), 0);
        const pending = relevant
          .filter((item) => item.status === "pending")
          .reduce((sum, item) => sum + Number(item.amount), 0);
        const committed = realized + pending;
        const amount = Number(budget.amount);
        const ratio = amount > 0 ? committed / amount : 0;

        return {
          ...budget,
          name:
            budget.scope === "category"
              ? categoryMap.get(budget.category_id ?? "") ?? "Categoria removida"
              : costCenterMap.get(budget.cost_center_id ?? "") ?? "Centro removido",
          realized,
          pending,
          committed,
          remaining: amount - committed,
          ratio,
          status:
            committed >= amount
              ? ("exceeded" as const)
              : ratio >= budget.alert_percent / 100
                ? ("warning" as const)
                : ("healthy" as const),
        };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }, [budgets, monthTransactions, categoryMap, costCenterMap]);

  const financials = useMemo(() => {
    const revenueRealized = monthTransactions
      .filter((item) => item.type === "income" && item.status === "paid")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const revenuePending = monthTransactions
      .filter((item) => item.type === "income" && item.status === "pending")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const expenseRealized = monthTransactions
      .filter((item) => item.type === "expense" && item.status === "paid")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const expensePending = monthTransactions
      .filter((item) => item.type === "expense" && item.status === "pending")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const openingBalance = accounts.reduce(
      (sum, item) => sum + Number(item.opening_balance ?? 0),
      0,
    );
    const activeAccountIds = new Set(accounts.map((item) => item.id));
    const realizedNet = paidTransactions
      .filter(
        (item) =>
          Boolean(item.account_id) &&
          activeAccountIds.has(item.account_id as string),
      )
      .reduce(
        (sum, item) =>
          sum + (item.type === "income" ? Number(item.amount) : -Number(item.amount)),
        0,
      );

    return {
      revenueRealized,
      revenuePending,
      expenseRealized,
      expensePending,
      currentBalance: openingBalance + realizedNet,
    };
  }, [monthTransactions, accounts, paidTransactions]);

  const goalRows = useMemo(() => {
    return goals.map((goal) => {
      const target = Number(goal.amount);
      let realized = 0;
      let projected = 0;
      let direction: "minimum" | "maximum" = "minimum";

      if (goal.kind === "revenue") {
        realized = financials.revenueRealized;
        projected = financials.revenueRealized + financials.revenuePending;
      } else if (goal.kind === "expense") {
        direction = "maximum";
        realized = financials.expenseRealized;
        projected = financials.expenseRealized + financials.expensePending;
      } else {
        realized = financials.currentBalance;
        projected = financials.currentBalance;
      }

      const ratio = target > 0 ? realized / target : 0;
      const projectedRatio = target > 0 ? projected / target : 0;
      const healthy =
        direction === "maximum" ? projected <= target : projected >= target;

      return {
        ...goal,
        target,
        realized,
        projected,
        ratio,
        projectedRatio,
        direction,
        healthy,
      };
    });
  }, [goals, financials]);

  const summary = useMemo(() => {
    const totalBudget = budgetRows.reduce((sum, item) => sum + Number(item.amount), 0);
    return {
      totalBudget,
      budgets: budgetRows.length,
      warning: budgetRows.filter((item) => item.status === "warning").length,
      exceeded: budgetRows.filter((item) => item.status === "exceeded").length,
    };
  }, [budgetRows]);

  async function saveBudget(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany || !canConfigure) return;

    const amount = parseMoney(budgetForm.amount);
    if (!budgetForm.targetId || amount <= 0) {
      setError("Escolha a categoria/centro de custo e informe um orçamento válido.");
      return;
    }

    setSavingBudget(true);
    setError("");

    const existing = budgets.find((item) =>
      budgetForm.scope === "category"
        ? item.scope === "category" && item.category_id === budgetForm.targetId
        : item.scope === "cost_center" && item.cost_center_id === budgetForm.targetId,
    );

    const payload = {
      company_id: activeCompany.id,
      period_start: periodStart(month),
      scope: budgetForm.scope,
      category_id: budgetForm.scope === "category" ? budgetForm.targetId : null,
      cost_center_id: budgetForm.scope === "cost_center" ? budgetForm.targetId : null,
      amount,
      alert_percent: Math.max(1, Math.min(100, budgetForm.alertPercent)),
      active: true,
      updated_at: new Date().toISOString(),
    };

    const result = existing
      ? await supabase
          .from("financial_budgets")
          .update(payload)
          .eq("id", existing.id)
          .eq("company_id", activeCompany.id)
      : await supabase.from("financial_budgets").insert(payload);

    if (result.error) {
      setError(result.error.message);
    } else {
      setBudgetForm({
        scope: budgetForm.scope,
        targetId: "",
        amount: "",
        alertPercent: 80,
      });
      await refreshPlanningAlerts();
      await load();
    }

    setSavingBudget(false);
  }

  async function saveGoal(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany || !canConfigure) return;

    const amount = parseMoney(goalForm.amount);
    if (amount <= 0) {
      setError("Informe um valor válido para a meta.");
      return;
    }

    setSavingGoal(true);
    setError("");

    const existing = goals.find((item) => item.kind === goalForm.kind);
    const payload = {
      company_id: activeCompany.id,
      period_start: periodStart(month),
      kind: goalForm.kind,
      amount,
      active: true,
      updated_at: new Date().toISOString(),
    };

    const result = existing
      ? await supabase
          .from("financial_goals")
          .update(payload)
          .eq("id", existing.id)
          .eq("company_id", activeCompany.id)
      : await supabase.from("financial_goals").insert(payload);

    if (result.error) {
      setError(result.error.message);
    } else {
      setGoalForm({ kind: goalForm.kind, amount: "" });
      await refreshPlanningAlerts();
      await load();
    }

    setSavingGoal(false);
  }

  async function confirmDelete() {
    if (!supabase || !activeCompany || !deleteTarget || !canConfigure) return;
    setDeleting(true);
    setError("");

    const table =
      deleteTarget.kind === "budget" ? "financial_budgets" : "financial_goals";

    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq("id", deleteTarget.id)
      .eq("company_id", activeCompany.id);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      await refreshPlanningAlerts();
      await load();
      setDeleteTarget(null);
    }

    setDeleting(false);
  }

  const targetOptions =
    budgetForm.scope === "category"
      ? categories.filter((item) => item.type === "expense" || item.type === "both")
      : costCenters;

  return (
    <>
      <header className="page-header split planning-header">
        <div>
          <p className="eyebrow">PLANEJAMENTO</p>
          <h1>Orçamentos e metas</h1>
          <p>Defina limites mensais, acompanhe o comprometimento e antecipe desvios.</p>
        </div>
        <label className="planning-month-picker">
          <span>Período</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </header>

      {error && <div className="form-alert error page-alert">{error}</div>}

      {loading ? (
        <section className="panel empty-state">Montando o planejamento financeiro...</section>
      ) : (
        <>
          <section className="metrics planning-metrics">
            <article className="metric-card">
              <span>Limites cadastrados</span>
              <strong>{money.format(summary.totalBudget)}</strong>
              <small>{summary.budgets} orçamento(s) em {monthLabel(month)}</small>
            </article>
            <article className="metric-card">
              <span>Receita realizada</span>
              <strong className="positive-value">{money.format(financials.revenueRealized)}</strong>
              <small>Prevista: {money.format(financials.revenueRealized + financials.revenuePending)}</small>
            </article>
            <article className="metric-card">
              <span>Despesa realizada</span>
              <strong className="negative-value">{money.format(financials.expenseRealized)}</strong>
              <small>Comprometida: {money.format(financials.expenseRealized + financials.expensePending)}</small>
            </article>
            <article className="metric-card">
              <span>Orçamentos em risco</span>
              <strong className={summary.exceeded ? "negative-value" : ""}>
                {summary.warning + summary.exceeded}
              </strong>
              <small>{summary.exceeded} excedido(s) · {summary.warning} em atenção</small>
            </article>
          </section>

          {canConfigure && (
            <section className="planning-forms-grid">
              <form className="panel planning-form-card" onSubmit={saveBudget}>
                <div className="panel-title">
                  <div>
                    <h2>Novo orçamento mensal</h2>
                    <p>Controle despesas por categoria ou centro de custo.</p>
                  </div>
                </div>
                <div className="planning-form-grid">
                  <label>
                    Escopo
                    <select
                      value={budgetForm.scope}
                      onChange={(event) =>
                        setBudgetForm({
                          ...budgetForm,
                          scope: event.target.value as BudgetScope,
                          targetId: "",
                        })
                      }
                    >
                      <option value="category">Categoria</option>
                      <option value="cost_center">Centro de custo</option>
                    </select>
                  </label>
                  <label>
                    {budgetForm.scope === "category" ? "Categoria" : "Centro de custo"}
                    <select
                      value={budgetForm.targetId}
                      onChange={(event) =>
                        setBudgetForm({ ...budgetForm, targetId: event.target.value })
                      }
                      required
                    >
                      <option value="">Selecione</option>
                      {targetOptions.map((item) => (
                        <option value={item.id} key={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Limite mensal
                    <input
                      value={budgetForm.amount}
                      onChange={(event) =>
                        setBudgetForm({ ...budgetForm, amount: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder="Ex.: 3.500,00"
                      required
                    />
                  </label>
                  <label>
                    Alertar em
                    <div className="planning-percent-input">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={budgetForm.alertPercent}
                        onChange={(event) =>
                          setBudgetForm({
                            ...budgetForm,
                            alertPercent: Number(event.target.value),
                          })
                        }
                      />
                      <span>%</span>
                    </div>
                  </label>
                </div>
                <div className="form-actions">
                  <button className="primary" disabled={savingBudget}>
                    {savingBudget ? "Salvando..." : "Salvar orçamento"}
                  </button>
                </div>
              </form>

              <form className="panel planning-form-card" onSubmit={saveGoal}>
                <div className="panel-title">
                  <div>
                    <h2>Meta mensal</h2>
                    <p>Acompanhe receita, despesa máxima ou saldo mínimo.</p>
                  </div>
                </div>
                <div className="planning-form-grid goal">
                  <label>
                    Meta
                    <select
                      value={goalForm.kind}
                      onChange={(event) =>
                        setGoalForm({ ...goalForm, kind: event.target.value as GoalKind })
                      }
                    >
                      <option value="revenue">Receita</option>
                      <option value="expense">Limite de despesas</option>
                      <option value="cash">Saldo mínimo</option>
                    </select>
                  </label>
                  <label>
                    Valor
                    <input
                      value={goalForm.amount}
                      onChange={(event) => setGoalForm({ ...goalForm, amount: event.target.value })}
                      inputMode="decimal"
                      placeholder="Ex.: 25.000,00"
                      required
                    />
                  </label>
                </div>
                <div className="form-actions">
                  <button className="primary" disabled={savingGoal}>
                    {savingGoal ? "Salvando..." : "Salvar meta"}
                  </button>
                </div>
              </form>
            </section>
          )}

          <section className="panel planning-budget-panel">
            <div className="panel-title report-panel-title">
              <div>
                <h2>Orçado × Realizado × Previsto</h2>
                <p>O comprometido soma despesas já pagas e contas pendentes no mês.</p>
              </div>
              <span className="report-count">{budgetRows.length} orçamento(s)</span>
            </div>

            {budgetRows.length === 0 ? (
              <div className="empty-inline">
                Nenhum orçamento definido para {monthLabel(month)}.
              </div>
            ) : (
              <div className="planning-budget-list">
                {budgetRows.map((item) => (
                  <article className={"planning-budget-row " + item.status} key={item.id}>
                    <div className="planning-budget-info">
                      <div>
                        <span className="planning-scope-label">
                          {item.scope === "category" ? "Categoria" : "Centro de custo"}
                        </span>
                        <strong>{item.name}</strong>
                      </div>
                      <div className="planning-budget-status">
                        <strong>
                          {item.status === "exceeded"
                            ? "Excedido"
                            : item.status === "warning"
                              ? "Atenção"
                              : "Dentro do plano"}
                        </strong>
                        <span>Alerta em {item.alert_percent}%</span>
                      </div>
                    </div>

                    <div className="planning-progress-track">
                      <i style={{ width: `${Math.min(100, item.ratio * 100)}%` }} />
                      <b
                        className="planning-realized-marker"
                        style={{
                          left: `${Math.min(
                            100,
                            (Number(item.amount) > 0
                              ? item.realized / Number(item.amount)
                              : 0) * 100,
                          )}%`,
                        }}
                      />
                    </div>

                    <div className="planning-budget-values">
                      <div><span>Orçado</span><strong>{money.format(Number(item.amount))}</strong></div>
                      <div><span>Realizado</span><strong>{money.format(item.realized)}</strong></div>
                      <div><span>Previsto</span><strong>{money.format(item.pending)}</strong></div>
                      <div>
                        <span>Comprometido</span>
                        <strong className={item.status === "exceeded" ? "negative-value" : ""}>
                          {money.format(item.committed)} · {percent.format(item.ratio)}
                        </strong>
                      </div>
                      <div>
                        <span>Disponível</span>
                        <strong className={item.remaining < 0 ? "negative-value" : "positive-value"}>
                          {money.format(item.remaining)}
                        </strong>
                      </div>
                      {canConfigure && (
                        <button
                          className="table-action danger"
                          type="button"
                          onClick={() =>
                            setDeleteTarget({ kind: "budget", id: item.id, label: item.name })
                          }
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel planning-goals-panel">
            <div className="panel-title report-panel-title">
              <div>
                <h2>Metas do mês</h2>
                <p>Compare resultado atual e projeção com o objetivo definido.</p>
              </div>
              <span className="report-count">{goalRows.length} meta(s)</span>
            </div>

            {goalRows.length === 0 ? (
              <div className="empty-inline">Nenhuma meta definida para {monthLabel(month)}.</div>
            ) : (
              <div className="planning-goal-grid">
                {goalRows.map((goal) => (
                  <article className={goal.healthy ? "planning-goal-card healthy" : "planning-goal-card warning"} key={goal.id}>
                    <div className="planning-goal-head">
                      <div>
                        <span>{goalLabels[goal.kind]}</span>
                        <strong>{money.format(goal.target)}</strong>
                      </div>
                      <b>{goal.healthy ? "No plano" : "Atenção"}</b>
                    </div>

                    <div className="planning-goal-progress">
                      <i
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, goal.projectedRatio * 100),
                          )}%`,
                        }}
                      />
                    </div>

                    <div className="planning-goal-values">
                      <div>
                        <span>Realizado agora</span>
                        <strong>{money.format(goal.realized)}</strong>
                      </div>
                      <div>
                        <span>{goal.kind === "cash" ? "Saldo atual" : "Projeção do mês"}</span>
                        <strong className={goal.healthy ? "positive-value" : "negative-value"}>
                          {money.format(goal.projected)}
                        </strong>
                      </div>
                    </div>

                    {canConfigure && (
                      <button
                        className="table-action danger"
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "goal",
                            id: goal.id,
                            label: goalLabels[goal.kind],
                          })
                        }
                      >
                        Excluir meta
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="planning-note">
            <strong>Radar automático</strong>
            <span>
              No mês atual, o Valora cria alertas quando um orçamento atinge o percentual
              configurado, quando um limite é excedido ou quando uma meta financeira entra
              em risco.
            </span>
          </section>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === "budget" ? "Excluir orçamento?" : "Excluir meta?"}
        description={
          deleteTarget
            ? `Você está prestes a excluir “${deleteTarget.label}” de ${monthLabel(month)}.`
            : ""
        }
        warning="Os lançamentos financeiros não serão alterados."
        confirmLabel={deleteTarget?.kind === "budget" ? "Excluir orçamento" : "Excluir meta"}
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
