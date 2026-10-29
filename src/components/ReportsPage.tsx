
import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type ReportBasis = "realized" | "scheduled";
type ReportView = "cashflow" | "dre";
type TransactionType = "income" | "expense";
type DreGroup =
  | "revenue"
  | "other_income"
  | "cost"
  | "operating_expense"
  | "tax"
  | "other_expense";

type Transaction = {
  id: string;
  description: string;
  amount: number | string;
  type: TransactionType;
  status: "pending" | "paid" | "cancelled";
  due_date: string;
  paid_at: string | null;
  category_id: string | null;
  cost_center_id: string | null;
  account_id: string | null;
  partner_id: string | null;
};

type NamedItem = { id: string; name: string };
type Category = NamedItem & { dre_group: DreGroup };

type DreSummary = {
  revenue: number;
  taxes: number;
  netRevenue: number;
  costs: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingResult: number;
  otherIncome: number;
  otherExpenses: number;
  netResult: number;
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
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

function firstDayOfCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayIso() {
  const now = new Date();
  return localIso(now);
}

function startOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

function localIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function dateForTransaction(item: Transaction, basis: ReportBasis) {
  if (basis === "realized") return item.paid_at?.slice(0, 10) ?? null;
  return item.due_date;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "");
}

function formatDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("pt-BR");
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return '"' + text.replace(/"/g, '""') + '"';
}

function previousPeriod(startDate: string, endDate: string) {
  const start = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);

  return {
    start: localIso(previousStart),
    end: localIso(previousEnd),
  };
}

function variation(current: number, previous: number) {
  if (Math.abs(previous) < 0.009) return null;
  return (current - previous) / Math.abs(previous);
}

function variationText(current: number, previous: number) {
  const value = variation(current, previous);
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${percent.format(value)}`;
}

function defaultDreGroup(type: TransactionType): DreGroup {
  return type === "income" ? "revenue" : "operating_expense";
}

function calculateDre(
  items: Transaction[],
  categoryMap: Map<string, Category>,
): DreSummary {
  let revenue = 0;
  let taxes = 0;
  let costs = 0;
  let operatingExpenses = 0;
  let otherIncome = 0;
  let otherExpenses = 0;

  for (const item of items) {
    const amount = Number(item.amount);
    const group =
      (item.category_id ? categoryMap.get(item.category_id)?.dre_group : null) ??
      defaultDreGroup(item.type);

    if (item.type === "income") {
      if (group === "other_income") otherIncome += amount;
      else revenue += amount;
      continue;
    }

    if (group === "tax") taxes += amount;
    else if (group === "cost") costs += amount;
    else if (group === "other_expense") otherExpenses += amount;
    else operatingExpenses += amount;
  }

  const netRevenue = revenue - taxes;
  const grossProfit = netRevenue - costs;
  const operatingResult = grossProfit - operatingExpenses;
  const netResult = operatingResult + otherIncome - otherExpenses;

  return {
    revenue,
    taxes,
    netRevenue,
    costs,
    grossProfit,
    operatingExpenses,
    operatingResult,
    otherIncome,
    otherExpenses,
    netResult,
    grossMargin: netRevenue > 0 ? grossProfit / netRevenue : 0,
    operatingMargin: netRevenue > 0 ? operatingResult / netRevenue : 0,
    netMargin: revenue > 0 ? netResult / revenue : 0,
  };
}

export function ReportsPage() {
  const { activeCompany } = useCompany();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<NamedItem[]>([]);
  const [accounts, setAccounts] = useState<NamedItem[]>([]);
  const [partners, setPartners] = useState<NamedItem[]>([]);
  const [view, setView] = useState<ReportView>("cashflow");
  const [basis, setBasis] = useState<ReportBasis>("realized");
  const [startDate, setStartDate] = useState(firstDayOfCurrentMonth());
  const [endDate, setEndDate] = useState(todayIso());
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionType>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [costCenterFilter, setCostCenterFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    if (!supabase || !activeCompany) return;

    setLoading(true);
    setError("");

    const [txResult, categoryResult, costCenterResult, accountResult, partnerResult] =
      await Promise.all([
        supabase
          .from("transactions")
          .select(
            "id, description, amount, type, status, due_date, paid_at, category_id, cost_center_id, account_id, partner_id",
          )
          .eq("company_id", activeCompany.id)
          .neq("status", "cancelled")
          .order("due_date", { ascending: true }),
        supabase
          .from("categories")
          .select("id, name, dre_group")
          .eq("company_id", activeCompany.id)
          .order("name"),
        supabase
          .from("cost_centers")
          .select("id, name")
          .eq("company_id", activeCompany.id)
          .order("name"),
        supabase
          .from("financial_accounts")
          .select("id, name")
          .eq("company_id", activeCompany.id)
          .order("name"),
        supabase
          .from("business_partners")
          .select("id, name")
          .eq("company_id", activeCompany.id)
          .order("name"),
      ]);

    const firstError =
      txResult.error ||
      categoryResult.error ||
      costCenterResult.error ||
      accountResult.error ||
      partnerResult.error;

    if (firstError) {
      setError(firstError.message);
    } else {
      setTransactions((txResult.data ?? []) as Transaction[]);
      setCategories((categoryResult.data ?? []) as Category[]);
      setCostCenters((costCenterResult.data ?? []) as NamedItem[]);
      setAccounts((accountResult.data ?? []) as NamedItem[]);
      setPartners((partnerResult.data ?? []) as NamedItem[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  const categoryMap = useMemo(
    () => new Map(categories.map((item) => [item.id, item])),
    [categories],
  );
  const categoryNames = useMemo(
    () => new Map(categories.map((item) => [item.id, item.name])),
    [categories],
  );
  const costCenterNames = useMemo(
    () => new Map(costCenters.map((item) => [item.id, item.name])),
    [costCenters],
  );
  const accountNames = useMemo(
    () => new Map(accounts.map((item) => [item.id, item.name])),
    [accounts],
  );
  const partnerNames = useMemo(
    () => new Map(partners.map((item) => [item.id, item.name])),
    [partners],
  );

  const period = useMemo(
    () => previousPeriod(startDate, endDate),
    [startDate, endDate],
  );

  function matchesSharedFilters(
    item: Transaction,
    periodStart: string,
    periodEnd: string,
    includeType: boolean,
  ) {
    if (basis === "realized" && item.status !== "paid") return false;

    const referenceDate = dateForTransaction(item, basis);
    if (!referenceDate) return false;
    if (referenceDate < periodStart || referenceDate > periodEnd) return false;
    if (includeType && typeFilter !== "all" && item.type !== typeFilter) return false;
    if (categoryFilter && item.category_id !== categoryFilter) return false;
    if (costCenterFilter && item.cost_center_id !== costCenterFilter) return false;
    if (accountFilter && item.account_id !== accountFilter) return false;

    return true;
  }

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((item) =>
        matchesSharedFilters(item, startDate, endDate, true),
      ),
    [
      transactions,
      basis,
      startDate,
      endDate,
      typeFilter,
      categoryFilter,
      costCenterFilter,
      accountFilter,
    ],
  );

  const dreTransactions = useMemo(
    () =>
      transactions.filter((item) =>
        matchesSharedFilters(item, startDate, endDate, false),
      ),
    [
      transactions,
      basis,
      startDate,
      endDate,
      categoryFilter,
      costCenterFilter,
      accountFilter,
    ],
  );

  const previousDreTransactions = useMemo(
    () =>
      transactions.filter((item) =>
        matchesSharedFilters(item, period.start, period.end, false),
      ),
    [
      transactions,
      basis,
      period.start,
      period.end,
      categoryFilter,
      costCenterFilter,
      accountFilter,
    ],
  );

  const summary = useMemo(() => {
    const income = filteredTransactions
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const expense = filteredTransactions
      .filter((item) => item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const result = income - expense;

    return {
      income,
      expense,
      result,
      margin: income > 0 ? result / income : 0,
      count: filteredTransactions.length,
    };
  }, [filteredTransactions]);

  const monthlyFlow = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();

    for (const item of filteredTransactions) {
      const referenceDate = dateForTransaction(item, basis);
      if (!referenceDate) continue;

      const key = monthKey(referenceDate);
      const current = map.get(key) ?? { income: 0, expense: 0 };
      current[item.type] += Number(item.amount);
      map.set(key, current);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => ({
        key,
        label: monthLabel(key),
        income: values.income,
        expense: values.expense,
        result: values.income - values.expense,
      }));
  }, [filteredTransactions, basis]);

  const maxMonthlyValue = Math.max(
    1,
    ...monthlyFlow.flatMap((item) => [item.income, item.expense]),
  );

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();

    for (const item of filteredTransactions) {
      const key = item.category_id ?? "__uncategorized__";
      const current = map.get(key) ?? { income: 0, expense: 0 };
      current[item.type] += Number(item.amount);
      map.set(key, current);
    }

    return Array.from(map.entries())
      .map(([id, values]) => ({
        id,
        name:
          id === "__uncategorized__"
            ? "Sem categoria"
            : categoryNames.get(id) ?? "Categoria removida",
        ...values,
        total: values.income + values.expense,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredTransactions, categoryNames]);

  const costCenterBreakdown = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();

    for (const item of filteredTransactions) {
      const key = item.cost_center_id ?? "__unassigned__";
      const current = map.get(key) ?? { income: 0, expense: 0 };
      current[item.type] += Number(item.amount);
      map.set(key, current);
    }

    return Array.from(map.entries())
      .map(([id, values]) => ({
        id,
        name:
          id === "__unassigned__"
            ? "Sem centro de custo"
            : costCenterNames.get(id) ?? "Centro removido",
        ...values,
        result: values.income - values.expense,
      }))
      .sort((a, b) => Math.abs(b.result) - Math.abs(a.result));
  }, [filteredTransactions, costCenterNames]);

  const dre = useMemo(
    () => calculateDre(dreTransactions, categoryMap),
    [dreTransactions, categoryMap],
  );

  const previousDre = useMemo(
    () => calculateDre(previousDreTransactions, categoryMap),
    [previousDreTransactions, categoryMap],
  );

  const dreRows = useMemo(
    () => [
      { key: "revenue", label: "(+) Receita bruta", current: dre.revenue, previous: previousDre.revenue, kind: "line" },
      { key: "taxes", label: "(−) Impostos e deduções", current: dre.taxes, previous: previousDre.taxes, kind: "line" },
      { key: "netRevenue", label: "Receita líquida", current: dre.netRevenue, previous: previousDre.netRevenue, kind: "subtotal" },
      { key: "costs", label: "(−) Custos diretos", current: dre.costs, previous: previousDre.costs, kind: "line" },
      { key: "grossProfit", label: "Lucro bruto", current: dre.grossProfit, previous: previousDre.grossProfit, kind: "subtotal" },
      { key: "operatingExpenses", label: "(−) Despesas operacionais", current: dre.operatingExpenses, previous: previousDre.operatingExpenses, kind: "line" },
      { key: "operatingResult", label: "Resultado operacional", current: dre.operatingResult, previous: previousDre.operatingResult, kind: "subtotal" },
      { key: "otherIncome", label: "(+) Outras receitas", current: dre.otherIncome, previous: previousDre.otherIncome, kind: "line" },
      { key: "otherExpenses", label: "(−) Outras despesas", current: dre.otherExpenses, previous: previousDre.otherExpenses, kind: "line" },
      { key: "netResult", label: "Resultado líquido", current: dre.netResult, previous: previousDre.netResult, kind: "total" },
    ],
    [dre, previousDre],
  );

  const topExpense = useMemo(() => {
    const map = new Map<string, number>();

    for (const item of dreTransactions) {
      if (item.type !== "expense") continue;
      const key = item.category_id ?? "__uncategorized__";
      map.set(key, (map.get(key) ?? 0) + Number(item.amount));
    }

    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;

    const [id, amount] = sorted[0];
    return {
      name:
        id === "__uncategorized__"
          ? "Sem categoria"
          : categoryNames.get(id) ?? "Categoria removida",
      amount,
    };
  }, [dreTransactions, categoryNames]);

  const monthlyDre = useMemo(() => {
    const map = new Map<string, Transaction[]>();

    for (const item of dreTransactions) {
      const referenceDate = dateForTransaction(item, basis);
      if (!referenceDate) continue;
      const key = monthKey(referenceDate);
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        key,
        label: monthLabel(key),
        ...calculateDre(items, categoryMap),
      }));
  }, [dreTransactions, basis, categoryMap]);

  function applyPreset(preset: "month" | "90days" | "year") {
    const now = new Date();

    if (preset === "month") {
      setStartDate(firstDayOfCurrentMonth());
      setEndDate(todayIso());
      return;
    }

    if (preset === "year") {
      setStartDate(startOfYear());
      setEndDate(todayIso());
      return;
    }

    const start = new Date(now);
    start.setDate(start.getDate() - 89);
    setStartDate(localIso(start));
    setEndDate(todayIso());
  }

  function exportCsv() {
    if (view === "dre") {
      const header = ["Linha", "Período atual", "Período anterior", "Variação"];
      const rows = dreRows.map((row) => [
        row.label,
        row.current.toFixed(2).replace(".", ","),
        row.previous.toFixed(2).replace(".", ","),
        variationText(row.current, row.previous),
      ]);

      const csv = [header, ...rows]
        .map((row) => row.map((cell) => csvCell(cell)).join(";"))
        .join("\r\n");

      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `valora-dre-${startDate}-a-${endDate}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return;
    }

    const header = [
      "Data",
      "Descrição",
      "Tipo",
      "Status",
      "Categoria",
      "Centro de custo",
      "Conta",
      "Cliente/Fornecedor",
      "Valor",
    ];

    const rows = filteredTransactions.map((item) => {
      const referenceDate = dateForTransaction(item, basis) ?? "";
      return [
        referenceDate,
        item.description,
        item.type === "income" ? "Receita" : "Despesa",
        item.status === "paid" ? "Pago/Recebido" : "Pendente",
        item.category_id ? categoryNames.get(item.category_id) ?? "" : "",
        item.cost_center_id ? costCenterNames.get(item.cost_center_id) ?? "" : "",
        item.account_id ? accountNames.get(item.account_id) ?? "" : "",
        item.partner_id ? partnerNames.get(item.partner_id) ?? "" : "",
        Number(item.amount).toFixed(2).replace(".", ","),
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvCell(cell)).join(";"))
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `valora-fluxo-${startDate}-a-${endDate}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="page-header split">
        <div>
          <p className="eyebrow">ANÁLISE</p>
          <h1>Relatórios</h1>
          <p>Fluxo de caixa e DRE gerencial com leitura comparativa do negócio.</p>
        </div>
        <button
          className="ghost"
          onClick={exportCsv}
          disabled={
            view === "dre"
              ? dreTransactions.length === 0
              : filteredTransactions.length === 0
          }
        >
          Exportar CSV
        </button>
      </header>

      <div className="report-mode-tabs" role="tablist" aria-label="Tipo de relatório">
        <button
          type="button"
          className={view === "cashflow" ? "active" : ""}
          onClick={() => setView("cashflow")}
        >
          Fluxo de caixa
        </button>
        <button
          type="button"
          className={view === "dre" ? "active" : ""}
          onClick={() => {
            setView("dre");
            setTypeFilter("all");
          }}
        >
          DRE
        </button>
      </div>

      <section className="panel report-filters">
        <div className="report-basis">
          <span>Visão</span>
          <div className="type-toggle">
            <button
              type="button"
              className={basis === "realized" ? "selected income" : ""}
              onClick={() => setBasis("realized")}
            >
              Realizado
            </button>
            <button
              type="button"
              className={basis === "scheduled" ? "selected income" : ""}
              onClick={() => setBasis("scheduled")}
            >
              Previsto
            </button>
          </div>
        </div>

        <label>
          De
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>

        <label>
          Até
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>

        {view === "cashflow" && (
          <label>
            Tipo
            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as "all" | TransactionType)
              }
            >
              <option value="all">Receitas e despesas</option>
              <option value="income">Somente receitas</option>
              <option value="expense">Somente despesas</option>
            </select>
          </label>
        )}

        <label>
          Categoria
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">Todas</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        <label>
          Centro de custo
          <select
            value={costCenterFilter}
            onChange={(event) => setCostCenterFilter(event.target.value)}
          >
            <option value="">Todos</option>
            {costCenters.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        <label>
          Conta
          <select
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
          >
            <option value="">Todas</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        <div className="report-presets">
          <button className="filter-tab" type="button" onClick={() => applyPreset("month")}>
            Este mês
          </button>
          <button className="filter-tab" type="button" onClick={() => applyPreset("90days")}>
            90 dias
          </button>
          <button className="filter-tab" type="button" onClick={() => applyPreset("year")}>
            Este ano
          </button>
        </div>
      </section>

      {error && <div className="form-alert error page-alert">{error}</div>}

      {loading ? (
        <section className="panel empty-state">Montando relatórios...</section>
      ) : view === "cashflow" ? (
        <>
          <section className="metrics report-metrics">
            <article className="metric-card">
              <span>Receitas</span>
              <strong>{money.format(summary.income)}</strong>
              <small>{basis === "realized" ? "Recebidas no período" : "Previstas no período"}</small>
            </article>
            <article className="metric-card">
              <span>Despesas</span>
              <strong>{money.format(summary.expense)}</strong>
              <small>{basis === "realized" ? "Pagas no período" : "Previstas no período"}</small>
            </article>
            <article className="metric-card">
              <span>Resultado</span>
              <strong className={summary.result < 0 ? "negative-value" : "positive-value"}>
                {money.format(summary.result)}
              </strong>
              <small>{summary.count} lançamento(s)</small>
            </article>
            <article className="metric-card">
              <span>Margem gerencial</span>
              <strong className={summary.margin < 0 ? "negative-value" : "positive-value"}>
                {summary.income > 0 ? percent.format(summary.margin) : "—"}
              </strong>
              <small>Resultado ÷ receitas</small>
            </article>
          </section>

          <section className="report-grid">
            <article className="panel report-flow-panel">
              <div className="panel-title">
                <div>
                  <h2>Fluxo mensal</h2>
                  <p>
                    {basis === "realized"
                      ? "Movimentações pela data da baixa"
                      : "Movimentações pela data de vencimento"}
                  </p>
                </div>
              </div>

              {monthlyFlow.length === 0 ? (
                <div className="empty-inline">Nenhuma movimentação no período.</div>
              ) : (
                <div className="report-months">
                  {monthlyFlow.map((month) => (
                    <div className="report-month" key={month.key}>
                      <div className="report-month-label">
                        <strong>{month.label}</strong>
                        <span className={month.result < 0 ? "negative-value" : "positive-value"}>
                          {money.format(month.result)}
                        </span>
                      </div>
                      <div className="report-bars">
                        <div
                          className="report-bar income"
                          style={{ width: `${Math.max(2, (month.income / maxMonthlyValue) * 100)}%` }}
                          title={`Receitas: ${money.format(month.income)}`}
                        />
                        <div
                          className="report-bar expense"
                          style={{ width: `${Math.max(2, (month.expense / maxMonthlyValue) * 100)}%` }}
                          title={`Despesas: ${money.format(month.expense)}`}
                        />
                      </div>
                      <div className="report-month-values">
                        <span>Receitas {money.format(month.income)}</span>
                        <span>Despesas {money.format(month.expense)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="panel report-spend-panel">
              <div className="panel-title">
                <div>
                  <h2>Maiores despesas</h2>
                  <p>Categorias que mais consumiram caixa no período</p>
                </div>
              </div>
              <div className="report-ranking">
                {categoryBreakdown
                  .filter((item) => item.expense > 0)
                  .sort((a, b) => b.expense - a.expense)
                  .slice(0, 6)
                  .map((item, index) => (
                    <div className="report-ranking-row" key={item.id}>
                      <span>{index + 1}</span>
                      <strong>{item.name}</strong>
                      <b>{money.format(item.expense)}</b>
                    </div>
                  ))}
                {categoryBreakdown.every((item) => item.expense <= 0) && (
                  <div className="empty-inline">Nenhuma despesa no período.</div>
                )}
              </div>
            </article>
          </section>

          <section className="report-grid secondary">
            <article className="panel table-panel report-table-panel">
              <div className="panel-title report-panel-title">
                <div>
                  <h2>Por categoria</h2>
                  <p>Composição de receitas e despesas</p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th className="right">Receitas</th>
                      <th className="right">Despesas</th>
                      <th className="right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryBreakdown.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong></td>
                        <td className="right amount income">{money.format(item.income)}</td>
                        <td className="right amount expense">{money.format(item.expense)}</td>
                        <td className="right">{money.format(item.total)}</td>
                      </tr>
                    ))}
                    {categoryBreakdown.length === 0 && (
                      <tr>
                        <td colSpan={4} className="report-empty-cell">Sem dados no período.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel table-panel report-table-panel">
              <div className="panel-title report-panel-title">
                <div>
                  <h2>Por centro de custo</h2>
                  <p>Resultado por área, obra ou projeto</p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Centro de custo</th>
                      <th className="right">Receitas</th>
                      <th className="right">Despesas</th>
                      <th className="right">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costCenterBreakdown.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong></td>
                        <td className="right amount income">{money.format(item.income)}</td>
                        <td className="right amount expense">{money.format(item.expense)}</td>
                        <td className={"right " + (item.result < 0 ? "negative-value" : "positive-value")}>
                          {money.format(item.result)}
                        </td>
                      </tr>
                    ))}
                    {costCenterBreakdown.length === 0 && (
                      <tr>
                        <td colSpan={4} className="report-empty-cell">Sem dados no período.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <section className="panel table-panel report-detail">
            <div className="panel-title report-panel-title">
              <div>
                <h2>Detalhamento</h2>
                <p>Lançamentos que compõem o fluxo de caixa atual</p>
              </div>
              <span className="report-count">{filteredTransactions.length} registro(s)</span>
            </div>

            <div className="table-scroll">
              <table className="report-detail-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Tipo</th>
                    <th>Categoria</th>
                    <th>Centro de custo</th>
                    <th>Conta</th>
                    <th className="right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((item) => {
                    const referenceDate = dateForTransaction(item, basis);
                    return (
                      <tr key={item.id}>
                        <td>{referenceDate ? formatDate(referenceDate) : "—"}</td>
                        <td>
                          <strong>{item.description}</strong>
                          {item.partner_id && (
                            <small className="cell-subtitle">
                              {partnerNames.get(item.partner_id) ?? "Parceiro removido"}
                            </small>
                          )}
                        </td>
                        <td>
                          <span className={"pill " + item.type}>
                            {item.type === "income" ? "Receita" : "Despesa"}
                          </span>
                        </td>
                        <td>{item.category_id ? categoryNames.get(item.category_id) ?? "—" : "—"}</td>
                        <td>{item.cost_center_id ? costCenterNames.get(item.cost_center_id) ?? "—" : "—"}</td>
                        <td>{item.account_id ? accountNames.get(item.account_id) ?? "—" : "—"}</td>
                        <td className={"right amount " + item.type}>
                          {money.format(Number(item.amount))}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="report-empty-cell">Nenhum lançamento corresponde aos filtros.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="dre-period-note">
            <strong>Comparação automática</strong>
            <span>
              Atual: {formatDate(startDate)} a {formatDate(endDate)} · anterior: {formatDate(period.start)} a {formatDate(period.end)}
            </span>
          </div>

          <section className="metrics report-metrics dre-metrics">
            <article className="metric-card">
              <span>Receita líquida</span>
              <strong>{money.format(dre.netRevenue)}</strong>
              <small>{variationText(dre.netRevenue, previousDre.netRevenue)} vs. período anterior</small>
            </article>
            <article className="metric-card">
              <span>Lucro bruto</span>
              <strong className={dre.grossProfit < 0 ? "negative-value" : "positive-value"}>
                {money.format(dre.grossProfit)}
              </strong>
              <small>Margem bruta {dre.netRevenue > 0 ? percent.format(dre.grossMargin) : "—"}</small>
            </article>
            <article className="metric-card">
              <span>Resultado operacional</span>
              <strong className={dre.operatingResult < 0 ? "negative-value" : "positive-value"}>
                {money.format(dre.operatingResult)}
              </strong>
              <small>Margem operacional {dre.netRevenue > 0 ? percent.format(dre.operatingMargin) : "—"}</small>
            </article>
            <article className="metric-card">
              <span>Resultado líquido</span>
              <strong className={dre.netResult < 0 ? "negative-value" : "positive-value"}>
                {money.format(dre.netResult)}
              </strong>
              <small>Margem líquida {dre.revenue > 0 ? percent.format(dre.netMargin) : "—"}</small>
            </article>
          </section>

          <section className="report-grid dre-professional-grid">
            <article className="panel dre-professional-panel">
              <div className="panel-title">
                <div>
                  <h2>DRE gerencial</h2>
                  <p>
                    {basis === "realized"
                      ? "Regime gerencial por caixa, usando lançamentos baixados"
                      : "Visão prevista, usando datas de vencimento"}
                  </p>
                </div>
              </div>

              <div className="dre-professional-table">
                <div className="dre-professional-head">
                  <span>Linha</span>
                  <span>Atual</span>
                  <span>Anterior</span>
                  <span>Variação</span>
                </div>
                {dreRows.map((row) => (
                  <div className={"dre-professional-row " + row.kind} key={row.key}>
                    <span>{row.label}</span>
                    <strong className={row.current < 0 ? "negative-value" : ""}>
                      {money.format(row.current)}
                    </strong>
                    <span>{money.format(row.previous)}</span>
                    <span className={
                      variation(row.current, row.previous) !== null &&
                      (variation(row.current, row.previous) ?? 0) < 0
                        ? "negative-value"
                        : "positive-value"
                    }>
                      {variationText(row.current, row.previous)}
                    </span>
                  </div>
                ))}
              </div>

              <p className="report-note">
                A DRE usa o campo <strong>Grupo na DRE</strong> de cada categoria. Ajuste a classificação em Categorias quando necessário.
              </p>
            </article>

            <article className="panel dre-insights-panel">
              <div className="panel-title">
                <div>
                  <h2>Leitura do período</h2>
                  <p>Indicadores para encontrar rapidamente onde o resultado está sendo formado</p>
                </div>
              </div>

              <div className="dre-insight-list">
                <div>
                  <span>Margem bruta</span>
                  <strong>{dre.netRevenue > 0 ? percent.format(dre.grossMargin) : "—"}</strong>
                  <small>Lucro bruto ÷ receita líquida</small>
                </div>
                <div>
                  <span>Margem operacional</span>
                  <strong>{dre.netRevenue > 0 ? percent.format(dre.operatingMargin) : "—"}</strong>
                  <small>Resultado operacional ÷ receita líquida</small>
                </div>
                <div>
                  <span>Margem líquida</span>
                  <strong>{dre.revenue > 0 ? percent.format(dre.netMargin) : "—"}</strong>
                  <small>Resultado líquido ÷ receita bruta</small>
                </div>
                <div>
                  <span>Maior gasto</span>
                  <strong>{topExpense ? topExpense.name : "—"}</strong>
                  <small>{topExpense ? money.format(topExpense.amount) : "Nenhuma despesa no período"}</small>
                </div>
              </div>
            </article>
          </section>

          <section className="panel table-panel dre-monthly-panel">
            <div className="panel-title report-panel-title">
              <div>
                <h2>Evolução mensal da DRE</h2>
                <p>Receita líquida, lucro bruto e resultado líquido mês a mês</p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className="right">Receita líquida</th>
                    <th className="right">Lucro bruto</th>
                    <th className="right">Resultado operacional</th>
                    <th className="right">Resultado líquido</th>
                    <th className="right">Margem líquida</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyDre.map((month) => (
                    <tr key={month.key}>
                      <td><strong>{month.label}</strong></td>
                      <td className="right">{money.format(month.netRevenue)}</td>
                      <td className={"right " + (month.grossProfit < 0 ? "negative-value" : "positive-value")}>
                        {money.format(month.grossProfit)}
                      </td>
                      <td className={"right " + (month.operatingResult < 0 ? "negative-value" : "positive-value")}>
                        {money.format(month.operatingResult)}
                      </td>
                      <td className={"right " + (month.netResult < 0 ? "negative-value" : "positive-value")}>
                        {money.format(month.netResult)}
                      </td>
                      <td className="right">
                        {month.revenue > 0 ? percent.format(month.netMargin) : "—"}
                      </td>
                    </tr>
                  ))}
                  {monthlyDre.length === 0 && (
                    <tr>
                      <td colSpan={6} className="report-empty-cell">Sem dados no período.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
