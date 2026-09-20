
import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type ReportBasis = "realized" | "scheduled";
type TransactionType = "income" | "expense";

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
  return new Date().toISOString().slice(0, 10);
}

function startOfYear() {
  return `${new Date().getFullYear()}-01-01`;
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
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit",
  }).replace(".", "");
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return '"' + text.replace(/"/g, '""') + '"';
}

export function ReportsPage() {
  const { activeCompany } = useCompany();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<NamedItem[]>([]);
  const [costCenters, setCostCenters] = useState<NamedItem[]>([]);
  const [accounts, setAccounts] = useState<NamedItem[]>([]);
  const [partners, setPartners] = useState<NamedItem[]>([]);
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
          .select("id, name")
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
      setCategories((categoryResult.data ?? []) as NamedItem[]);
      setCostCenters((costCenterResult.data ?? []) as NamedItem[]);
      setAccounts((accountResult.data ?? []) as NamedItem[]);
      setPartners((partnerResult.data ?? []) as NamedItem[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

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

  const filteredTransactions = useMemo(() => {
    return transactions.filter((item) => {
      if (basis === "realized" && item.status !== "paid") return false;

      const referenceDate = dateForTransaction(item, basis);
      if (!referenceDate) return false;
      if (referenceDate < startDate || referenceDate > endDate) return false;
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (categoryFilter && item.category_id !== categoryFilter) return false;
      if (costCenterFilter && item.cost_center_id !== costCenterFilter) return false;
      if (accountFilter && item.account_id !== accountFilter) return false;

      return true;
    });
  }, [
    transactions,
    basis,
    startDate,
    endDate,
    typeFilter,
    categoryFilter,
    costCenterFilter,
    accountFilter,
  ]);

  const summary = useMemo(() => {
    const income = filteredTransactions
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const expense = filteredTransactions
      .filter((item) => item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const result = income - expense;
    const margin = income > 0 ? result / income : 0;

    return {
      income,
      expense,
      result,
      margin,
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

  const expenseCategories = categoryBreakdown
    .filter((item) => item.expense > 0)
    .sort((a, b) => b.expense - a.expense);

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
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(todayIso());
  }

  function exportCsv() {
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
    anchor.download = `valora-relatorio-${startDate}-a-${endDate}.csv`;
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
          <p>Fluxo de caixa, DRE gerencial e composição dos resultados em um só lugar.</p>
        </div>
        <button
          className="ghost"
          onClick={exportCsv}
          disabled={filteredTransactions.length === 0}
        >
          Exportar CSV
        </button>
      </header>

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
      ) : (
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

            <article className="panel dre-panel">
              <div className="panel-title">
                <div>
                  <h2>DRE gerencial simplificada</h2>
                  <p>
                    {basis === "realized"
                      ? "Visão por caixa, baseada em baixas realizadas"
                      : "Visão prevista, baseada nos vencimentos"}
                  </p>
                </div>
              </div>

              <div className="dre-table">
                <div className="dre-row strong">
                  <span>(+) Receitas</span>
                  <strong>{money.format(summary.income)}</strong>
                </div>

                {expenseCategories.slice(0, 8).map((category) => (
                  <div className="dre-row sub" key={category.id}>
                    <span>(−) {category.name}</span>
                    <strong>{money.format(category.expense)}</strong>
                  </div>
                ))}

                {summary.expense > 0 && expenseCategories.length === 0 && (
                  <div className="dre-row sub">
                    <span>(−) Despesas</span>
                    <strong>{money.format(summary.expense)}</strong>
                  </div>
                )}

                <div className="dre-row total">
                  <span>(=) Resultado</span>
                  <strong className={summary.result < 0 ? "negative-value" : "positive-value"}>
                    {money.format(summary.result)}
                  </strong>
                </div>

                <div className="dre-row">
                  <span>Margem</span>
                  <strong>{summary.income > 0 ? percent.format(summary.margin) : "—"}</strong>
                </div>
              </div>

              <p className="report-note">
                Esta é uma visão gerencial. Não substitui a DRE contábil elaborada pelo contador.
              </p>
            </article>
          </section>

          <section className="report-grid secondary">
            <article className="panel table-panel report-table-panel">
              <div className="panel-title report-panel-title">
                <div>
                  <h2>Por categoria</h2>
                  <p>Composição das receitas e despesas</p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th className="right">Receitas</th>
                      <th className="right">Despesas</th>
                      <th className="right">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryBreakdown.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong></td>
                        <td className="right amount income">{money.format(item.income)}</td>
                        <td className="right amount expense">{money.format(item.expense)}</td>
                        <td className={"right " + (item.income - item.expense < 0 ? "negative-value" : "positive-value")}>
                          {money.format(item.income - item.expense)}
                        </td>
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
                <p>Lançamentos que compõem o relatório atual</p>
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
                        <td>
                          {referenceDate
                            ? new Date(referenceDate + "T12:00:00").toLocaleDateString("pt-BR")
                            : "—"}
                        </td>
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
      )}
    </>
  );
}
