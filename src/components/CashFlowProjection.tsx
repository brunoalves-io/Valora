import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type Horizon = 7 | 30 | 60 | 90;
type TransactionType = "income" | "expense";

type Account = {
  id: string;
  name: string;
  opening_balance: number | string;
  active: boolean;
};

type Transaction = {
  id: string;
  description: string;
  amount: number | string;
  type: TransactionType;
  status: "pending" | "paid" | "cancelled";
  due_date: string;
  paid_at: string | null;
  account_id: string | null;
};

type DailyPoint = {
  date: string;
  income: number;
  expense: number;
  balance: number;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function localIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function todayIso() {
  return localIso(new Date());
}

function addDaysIso(value: string, days: number) {
  const date = new Date(value + "T12:00:00");
  date.setDate(date.getDate() + days);
  return localIso(date);
}

function formatDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("pt-BR");
}

function compactDate(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function signedAmount(item: Transaction) {
  const amount = Number(item.amount);
  return item.type === "income" ? amount : -amount;
}

export function CashFlowProjection() {
  const { activeCompany } = useCompany();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [horizon, setHorizon] = useState<Horizon>(30);
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    if (!supabase || !activeCompany) return;

    setLoading(true);
    setError("");

    const [accountResult, txResult] = await Promise.all([
      supabase
        .from("financial_accounts")
        .select("id, name, opening_balance, active")
        .eq("company_id", activeCompany.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("transactions")
        .select("id, description, amount, type, status, due_date, paid_at, account_id")
        .eq("company_id", activeCompany.id)
        .neq("status", "cancelled")
        .order("due_date", { ascending: true }),
    ]);

    if (accountResult.error || txResult.error) {
      setError(
        accountResult.error?.message ||
          txResult.error?.message ||
          "Não foi possível montar a projeção.",
      );
    } else {
      setAccounts((accountResult.data ?? []) as Account[]);
      setTransactions((txResult.data ?? []) as Transaction[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    setAccountId("");
    void load();
  }, [activeCompany?.id]);

  const projection = useMemo(() => {
    const today = todayIso();
    const endDate = addDaysIso(today, horizon - 1);
    const activeIds = new Set(accounts.map((account) => account.id));

    const scopedAccounts = accountId
      ? accounts.filter((account) => account.id === accountId)
      : accounts;

    const scopedIds = new Set(scopedAccounts.map((account) => account.id));

    const openingBalance = scopedAccounts.reduce(
      (sum, account) => sum + Number(account.opening_balance ?? 0),
      0,
    );

    const realizedNet = transactions
      .filter(
        (item) =>
          item.status === "paid" &&
          Boolean(item.account_id) &&
          scopedIds.has(item.account_id as string),
      )
      .reduce((sum, item) => sum + signedAmount(item), 0);

    const currentBalance = openingBalance + realizedNet;

    const pending = transactions
      .filter((item) => {
        if (item.status !== "pending") return false;
        if (item.due_date > endDate) return false;

        if (accountId) return item.account_id === accountId;

        return !item.account_id || activeIds.has(item.account_id);
      })
      .map((item) => ({
        ...item,
        forecastDate: item.due_date < today ? today : item.due_date,
      }))
      .sort((a, b) =>
        a.forecastDate.localeCompare(b.forecastDate) ||
        a.due_date.localeCompare(b.due_date) ||
        a.description.localeCompare(b.description),
      );

    const dailyMap = new Map<string, { income: number; expense: number }>();
    for (const item of pending) {
      const current = dailyMap.get(item.forecastDate) ?? { income: 0, expense: 0 };
      if (item.type === "income") current.income += Number(item.amount);
      else current.expense += Number(item.amount);
      dailyMap.set(item.forecastDate, current);
    }

    const daily: DailyPoint[] = [];
    let runningBalance = currentBalance;

    for (let index = 0; index < horizon; index += 1) {
      const date = addDaysIso(today, index);
      const flow = dailyMap.get(date) ?? { income: 0, expense: 0 };
      runningBalance += flow.income - flow.expense;
      daily.push({
        date,
        income: flow.income,
        expense: flow.expense,
        balance: runningBalance,
      });
    }

    const income = pending
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const expense = pending
      .filter((item) => item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const projectedBalance = daily.at(-1)?.balance ?? currentBalance;
    const minimum = daily.reduce(
      (lowest, item) =>
        item.balance < lowest.balance ? { balance: item.balance, date: item.date } : lowest,
      { balance: currentBalance, date: today },
    );

    const firstNegative =
      currentBalance < 0
        ? today
        : daily.find((item) => item.balance < 0)?.date ?? null;

    const overdue = transactions.filter((item) => {
      if (item.status !== "pending" || item.due_date >= today) return false;
      if (accountId) return item.account_id === accountId;
      return !item.account_id || activeIds.has(item.account_id);
    });

    const overdueIncome = overdue
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const overdueExpense = overdue
      .filter((item) => item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const unassignedPending = accountId
      ? 0
      : pending.filter((item) => !item.account_id).length;

    const unassignedPaid = accountId
      ? 0
      : transactions.filter((item) => item.status === "paid" && !item.account_id).length;

    const bucketSize = horizon <= 7 ? 1 : horizon <= 30 ? 3 : horizon <= 60 ? 5 : 7;
    const buckets: Array<{
      start: string;
      end: string;
      income: number;
      expense: number;
      balance: number;
    }> = [];

    for (let start = 0; start < daily.length; start += bucketSize) {
      const slice = daily.slice(start, start + bucketSize);
      if (!slice.length) continue;
      buckets.push({
        start: slice[0].date,
        end: slice[slice.length - 1].date,
        income: slice.reduce((sum, item) => sum + item.income, 0),
        expense: slice.reduce((sum, item) => sum + item.expense, 0),
        balance: slice[slice.length - 1].balance,
      });
    }

    return {
      today,
      endDate,
      currentBalance,
      income,
      expense,
      projectedBalance,
      minimum,
      firstNegative,
      overdueIncome,
      overdueExpense,
      unassignedPending,
      unassignedPaid,
      pending,
      buckets,
    };
  }, [accounts, transactions, horizon, accountId]);

  const chart = useMemo(() => {
    const width = 760;
    const height = 270;
    const left = 46;
    const right = 18;
    const lineTop = 24;
    const lineBottom = 168;
    const barTop = 186;
    const barBottom = 242;
    const plotWidth = width - left - right;
    const bucketWidth = plotWidth / Math.max(1, projection.buckets.length);
    const maxFlow = Math.max(
      1,
      ...projection.buckets.flatMap((item) => [item.income, item.expense]),
    );
    const balances = [
      projection.currentBalance,
      ...projection.buckets.map((item) => item.balance),
    ];
    const rawMin = Math.min(...balances);
    const rawMax = Math.max(...balances);
    const pad = Math.max(1, Math.abs(rawMax - rawMin) * 0.12);
    const balanceMin = rawMin - pad;
    const balanceMax = rawMax + pad;
    const balanceRange = Math.max(1, balanceMax - balanceMin);

    const yForBalance = (value: number) =>
      lineBottom -
      ((value - balanceMin) / balanceRange) * (lineBottom - lineTop);

    const zeroY =
      balanceMin <= 0 && balanceMax >= 0 ? yForBalance(0) : null;

    const linePoints = projection.buckets
      .map((item, index) => {
        const x = left + bucketWidth * index + bucketWidth / 2;
        return `${x.toFixed(1)},${yForBalance(item.balance).toFixed(1)}`;
      })
      .join(" ");

    return {
      width,
      height,
      left,
      plotWidth,
      bucketWidth,
      linePoints,
      barTop,
      barBottom,
      maxFlow,
      zeroY,
      yForBalance,
    };
  }, [projection]);

  if (loading) {
    return <section className="panel empty-state">Calculando projeção de caixa...</section>;
  }

  if (error) {
    return <div className="form-alert error page-alert">{error}</div>;
  }

  const riskLevel = projection.firstNegative
    ? "danger"
    : projection.minimum.balance < 0
      ? "danger"
      : projection.minimum.balance < Math.max(100, projection.currentBalance * 0.15)
        ? "warning"
        : "healthy";

  const selectedAccountName = accountId
    ? accounts.find((account) => account.id === accountId)?.name ?? "Conta"
    : "Todas as contas";

  return (
    <div className="cash-projection">
      <section className="panel projection-toolbar">
        <div>
          <span className="projection-kicker">PROJEÇÃO DE CAIXA</span>
          <h2>Próximos {horizon} dias</h2>
          <p>
            Saldo registrado + contas a pagar/receber e recorrências já previstas no Valora.
          </p>
        </div>

        <div className="projection-controls">
          <label>
            Conta
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Todas as contas</option>
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>

          <div className="projection-horizons" aria-label="Horizonte da projeção">
            {([7, 30, 60, 90] as Horizon[]).map((days) => (
              <button
                type="button"
                key={days}
                className={horizon === days ? "active" : ""}
                onClick={() => setHorizon(days)}
              >
                {days}d
              </button>
            ))}
          </div>

          <button className="ghost projection-refresh" type="button" onClick={() => void load()}>
            Atualizar
          </button>
        </div>
      </section>

      <section className="metrics report-metrics projection-metrics">
        <article className="metric-card">
          <span>Saldo atual</span>
          <strong className={projection.currentBalance < 0 ? "negative-value" : ""}>
            {money.format(projection.currentBalance)}
          </strong>
          <small>{selectedAccountName}</small>
        </article>
        <article className="metric-card">
          <span>Entradas previstas</span>
          <strong className="positive-value">{money.format(projection.income)}</strong>
          <small>Até {formatDate(projection.endDate)}</small>
        </article>
        <article className="metric-card">
          <span>Saídas previstas</span>
          <strong className="negative-value">{money.format(projection.expense)}</strong>
          <small>Até {formatDate(projection.endDate)}</small>
        </article>
        <article className="metric-card">
          <span>Saldo projetado</span>
          <strong className={projection.projectedBalance < 0 ? "negative-value" : "positive-value"}>
            {money.format(projection.projectedBalance)}
          </strong>
          <small>Variação de {money.format(projection.projectedBalance - projection.currentBalance)}</small>
        </article>
      </section>

      <section className={`projection-risk ${riskLevel}`}>
        <div className="projection-risk-icon" aria-hidden="true">
          {riskLevel === "danger" ? "!" : riskLevel === "warning" ? "↘" : "✓"}
        </div>
        <div>
          <strong>
            {projection.firstNegative
              ? `Risco de caixa negativo em ${formatDate(projection.firstNegative)}`
              : riskLevel === "warning"
                ? "Reserva de caixa ficará apertada neste horizonte"
                : "Nenhum saldo negativo projetado neste horizonte"}
          </strong>
          <span>
            Menor saldo previsto: {money.format(projection.minimum.balance)}
            {projection.minimum.date !== projection.today
              ? ` em ${formatDate(projection.minimum.date)}`
              : " no saldo atual"}.
          </span>
        </div>
        <div className="projection-risk-meta">
          {projection.overdueExpense > 0 && (
            <span>Vencido a pagar: {money.format(projection.overdueExpense)}</span>
          )}
          {projection.overdueIncome > 0 && (
            <span>Vencido a receber: {money.format(projection.overdueIncome)}</span>
          )}
        </div>
      </section>

      <section className="report-grid projection-grid">
        <article className="panel projection-chart-panel">
          <div className="panel-title projection-title">
            <div>
              <h2>Entradas, saídas e saldo acumulado</h2>
              <p>
                Lançamentos vencidos entram no primeiro dia para mostrar a pressão real de caixa.
              </p>
            </div>
            <div className="projection-legend">
              <span><i className="income" /> Entradas</span>
              <span><i className="expense" /> Saídas</span>
              <span><i className="balance" /> Saldo</span>
            </div>
          </div>

          {projection.buckets.length === 0 ? (
            <div className="empty-inline">Sem movimentações previstas neste horizonte.</div>
          ) : (
            <div className="projection-chart-scroll">
              <svg
                className="projection-chart"
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                role="img"
                aria-label="Gráfico de fluxo de caixa projetado"
              >
                <line
                  x1={chart.left}
                  y1={chart.barBottom}
                  x2={chart.left + chart.plotWidth}
                  y2={chart.barBottom}
                  className="projection-axis"
                />

                {chart.zeroY !== null && (
                  <line
                    x1={chart.left}
                    y1={chart.zeroY}
                    x2={chart.left + chart.plotWidth}
                    y2={chart.zeroY}
                    className="projection-zero-line"
                  />
                )}

                {projection.buckets.map((item, index) => {
                  const x = chart.left + chart.bucketWidth * index;
                  const usableWidth = Math.max(8, chart.bucketWidth - 8);
                  const barWidth = Math.max(3, Math.min(10, usableWidth / 2 - 2));
                  const incomeHeight =
                    (item.income / chart.maxFlow) * (chart.barBottom - chart.barTop);
                  const expenseHeight =
                    (item.expense / chart.maxFlow) * (chart.barBottom - chart.barTop);
                  const center = x + chart.bucketWidth / 2;

                  return (
                    <g key={item.start}>
                      <rect
                        x={center - barWidth - 1}
                        y={chart.barBottom - incomeHeight}
                        width={barWidth}
                        height={incomeHeight}
                        rx="2"
                        className="projection-bar-income"
                      />
                      <rect
                        x={center + 1}
                        y={chart.barBottom - expenseHeight}
                        width={barWidth}
                        height={expenseHeight}
                        rx="2"
                        className="projection-bar-expense"
                      />
                      {(index === 0 ||
                        index === projection.buckets.length - 1 ||
                        index % Math.max(1, Math.floor(projection.buckets.length / 5)) === 0) && (
                        <text
                          x={center}
                          y="260"
                          textAnchor="middle"
                          className="projection-chart-label"
                        >
                          {compactDate(item.end)}
                        </text>
                      )}
                    </g>
                  );
                })}

                <polyline
                  points={chart.linePoints}
                  fill="none"
                  className="projection-balance-line"
                />

                {projection.buckets.map((item, index) => {
                  const x = chart.left + chart.bucketWidth * index + chart.bucketWidth / 2;
                  const y = chart.yForBalance(item.balance);
                  return (
                    <circle
                      key={`point-${item.start}`}
                      cx={x}
                      cy={y}
                      r={projection.buckets.length > 18 ? 2.2 : 3.4}
                      className={item.balance < 0 ? "projection-point negative" : "projection-point"}
                    />
                  );
                })}
              </svg>
            </div>
          )}
        </article>

        <article className="panel projection-insights-panel">
          <div className="panel-title">
            <div>
              <h2>Leitura de liquidez</h2>
              <p>Pontos que merecem atenção antes que virem surpresa.</p>
            </div>
          </div>

          <div className="projection-insight-list">
            <div>
              <span>Menor saldo</span>
              <strong className={projection.minimum.balance < 0 ? "negative-value" : ""}>
                {money.format(projection.minimum.balance)}
              </strong>
              <small>{formatDate(projection.minimum.date)}</small>
            </div>
            <div>
              <span>Resultado previsto</span>
              <strong
                className={
                  projection.income - projection.expense < 0
                    ? "negative-value"
                    : "positive-value"
                }
              >
                {money.format(projection.income - projection.expense)}
              </strong>
              <small>Entradas menos saídas</small>
            </div>
            <div>
              <span>Contas vencidas</span>
              <strong>
                {money.format(projection.overdueExpense)} / {money.format(projection.overdueIncome)}
              </strong>
              <small>A pagar / a receber</small>
            </div>
            <div>
              <span>Qualidade da projeção</span>
              <strong>
                {projection.unassignedPending === 0 && projection.unassignedPaid === 0
                  ? "Completa"
                  : "Revisar"}
              </strong>
              <small>
                {projection.unassignedPending + projection.unassignedPaid === 0
                  ? "Todos os lançamentos relevantes possuem conta"
                  : `${projection.unassignedPending} pendente(s) e ${projection.unassignedPaid} realizado(s) sem conta`}
              </small>
            </div>
          </div>
        </article>
      </section>

      <section className="panel table-panel projection-upcoming">
        <div className="panel-title report-panel-title">
          <div>
            <h2>Próximos impactos no caixa</h2>
            <p>
              Primeiro os vencidos, depois os próximos compromissos e recebimentos.
            </p>
          </div>
          <span className="report-count">{projection.pending.length} lançamento(s)</span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>Conta</th>
                <th>Tipo</th>
                <th className="right">Impacto</th>
              </tr>
            </thead>
            <tbody>
              {projection.pending.slice(0, 14).map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{formatDate(item.due_date)}</strong>
                    {item.due_date < projection.today && (
                      <small className="cell-subtitle projection-overdue">Vencido</small>
                    )}
                  </td>
                  <td>{item.description}</td>
                  <td>
                    {item.account_id
                      ? accounts.find((account) => account.id === item.account_id)?.name ?? "Conta removida"
                      : "Sem conta"}
                  </td>
                  <td>
                    <span className={"pill " + item.type}>
                      {item.type === "income" ? "Entrada" : "Saída"}
                    </span>
                  </td>
                  <td className={"right amount " + item.type}>
                    {item.type === "income" ? "+" : "−"} {money.format(Number(item.amount))}
                  </td>
                </tr>
              ))}
              {projection.pending.length === 0 && (
                <tr>
                  <td colSpan={5} className="report-empty-cell">
                    Nenhuma conta pendente dentro deste horizonte.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {projection.pending.length > 14 && (
          <div className="projection-table-foot">
            Mostrando os 14 primeiros impactos de {projection.pending.length}.
          </div>
        )}
      </section>
    </div>
  );
}
