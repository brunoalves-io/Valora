import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type Horizon = 30 | 60 | 90;
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

type Forecast = {
  daily: DailyPoint[];
  projectedBalance: number;
  minimumBalance: number;
  minimumBalanceDate: string;
  firstNegativeDate: string | null;
  income: number;
  expense: number;
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

function addMonthsIso(value: string, months: number) {
  const source = new Date(value + "T12:00:00");
  const day = source.getDate();
  const target = new Date(source.getFullYear(), source.getMonth() + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, lastDay));
  return localIso(target);
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

function parseNumber(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signedAmount(item: Transaction) {
  const amount = Number(item.amount);
  return item.type === "income" ? amount : -amount;
}

function buildForecast(
  today: string,
  horizon: Horizon,
  currentBalance: number,
  flows: Array<{ date: string; type: TransactionType; amount: number }>,
): Forecast {
  const endDate = addDaysIso(today, horizon - 1);
  const dailyMap = new Map<string, { income: number; expense: number }>();

  for (const flow of flows) {
    if (flow.date > endDate || flow.amount <= 0) continue;
    const effectiveDate = flow.date < today ? today : flow.date;
    const current = dailyMap.get(effectiveDate) ?? { income: 0, expense: 0 };
    if (flow.type === "income") current.income += flow.amount;
    else current.expense += flow.amount;
    dailyMap.set(effectiveDate, current);
  }

  const daily: DailyPoint[] = [];
  let running = currentBalance;
  let minimumBalance = currentBalance;
  let minimumBalanceDate = today;
  let firstNegativeDate: string | null = currentBalance < 0 ? today : null;
  let income = 0;
  let expense = 0;

  for (let index = 0; index < horizon; index += 1) {
    const date = addDaysIso(today, index);
    const flow = dailyMap.get(date) ?? { income: 0, expense: 0 };
    income += flow.income;
    expense += flow.expense;
    running += flow.income - flow.expense;

    if (running < minimumBalance) {
      minimumBalance = running;
      minimumBalanceDate = date;
    }

    if (!firstNegativeDate && running < 0) {
      firstNegativeDate = date;
    }

    daily.push({
      date,
      income: flow.income,
      expense: flow.expense,
      balance: running,
    });
  }

  return {
    daily,
    projectedBalance: running,
    minimumBalance,
    minimumBalanceDate,
    firstNegativeDate,
    income,
    expense,
  };
}

export function FinancialScenarios() {
  const { activeCompany } = useCompany();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [horizon, setHorizon] = useState<Horizon>(60);
  const [incomeChangePct, setIncomeChangePct] = useState(0);
  const [expenseChangePct, setExpenseChangePct] = useState(0);
  const [incomeDelayDays, setIncomeDelayDays] = useState(0);
  const [monthlyExpense, setMonthlyExpense] = useState("");
  const [monthlyExpenseStart, setMonthlyExpenseStart] = useState(todayIso());
  const [oneOffType, setOneOffType] = useState<TransactionType>("expense");
  const [oneOffAmount, setOneOffAmount] = useState("");
  const [oneOffDate, setOneOffDate] = useState(todayIso());
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
          "Não foi possível montar os cenários financeiros.",
      );
    } else {
      setAccounts((accountResult.data ?? []) as Account[]);
      setTransactions((txResult.data ?? []) as Transaction[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  const model = useMemo(() => {
    const today = todayIso();
    const activeIds = new Set(accounts.map((account) => account.id));
    const openingBalance = accounts.reduce(
      (sum, account) => sum + Number(account.opening_balance ?? 0),
      0,
    );

    const realizedNet = transactions
      .filter(
        (item) =>
          item.status === "paid" &&
          Boolean(item.account_id) &&
          activeIds.has(item.account_id as string),
      )
      .reduce((sum, item) => sum + signedAmount(item), 0);

    const currentBalance = openingBalance + realizedNet;

    const pending = transactions.filter(
      (item) =>
        item.status === "pending" &&
        (!item.account_id || activeIds.has(item.account_id)),
    );

    const baseFlows = pending.map((item) => ({
      date: item.due_date,
      type: item.type,
      amount: Number(item.amount),
    }));

    const incomeFactor = Math.max(0, 1 + incomeChangePct / 100);
    const expenseFactor = Math.max(0, 1 + expenseChangePct / 100);

    const scenarioFlows = pending.map((item) => ({
      date:
        item.type === "income"
          ? addDaysIso(item.due_date, Math.max(0, incomeDelayDays))
          : item.due_date,
      type: item.type,
      amount:
        Number(item.amount) *
        (item.type === "income" ? incomeFactor : expenseFactor),
    }));

    const extraMonthly = Math.max(0, parseNumber(monthlyExpense));
    if (extraMonthly > 0) {
      let occurrence = monthlyExpenseStart < today ? today : monthlyExpenseStart;
      let guard = 0;
      const endDate = addDaysIso(today, horizon - 1);

      while (occurrence <= endDate && guard < 24) {
        scenarioFlows.push({
          date: occurrence,
          type: "expense",
          amount: extraMonthly,
        });
        occurrence = addMonthsIso(occurrence, 1);
        guard += 1;
      }
    }

    const extraOneOff = Math.max(0, parseNumber(oneOffAmount));
    if (extraOneOff > 0) {
      scenarioFlows.push({
        date: oneOffDate < today ? today : oneOffDate,
        type: oneOffType,
        amount: extraOneOff,
      });
    }

    const baseline = buildForecast(today, horizon, currentBalance, baseFlows);
    const scenario = buildForecast(today, horizon, currentBalance, scenarioFlows);

    const unassigned = pending.filter((item) => !item.account_id).length;

    return {
      today,
      endDate: addDaysIso(today, horizon - 1),
      currentBalance,
      baseline,
      scenario,
      unassigned,
      impact: scenario.projectedBalance - baseline.projectedBalance,
      minimumImpact: scenario.minimumBalance - baseline.minimumBalance,
    };
  }, [
    accounts,
    transactions,
    horizon,
    incomeChangePct,
    expenseChangePct,
    incomeDelayDays,
    monthlyExpense,
    monthlyExpenseStart,
    oneOffAmount,
    oneOffDate,
    oneOffType,
  ]);

  const chart = useMemo(() => {
    const width = 820;
    const height = 286;
    const left = 52;
    const right = 18;
    const top = 24;
    const bottom = 230;
    const plotWidth = width - left - right;
    const plotHeight = bottom - top;

    const points = [
      model.currentBalance,
      ...model.baseline.daily.map((item) => item.balance),
      ...model.scenario.daily.map((item) => item.balance),
    ];

    const rawMin = Math.min(...points);
    const rawMax = Math.max(...points);
    const padding = Math.max(100, Math.abs(rawMax - rawMin) * 0.12);
    const min = rawMin - padding;
    const max = rawMax + padding;
    const range = Math.max(1, max - min);

    const xForIndex = (index: number) =>
      left + (index / Math.max(1, horizon - 1)) * plotWidth;

    const yForValue = (value: number) =>
      bottom - ((value - min) / range) * plotHeight;

    const baselinePoints = model.baseline.daily
      .map((item, index) => `${xForIndex(index).toFixed(1)},${yForValue(item.balance).toFixed(1)}`)
      .join(" ");

    const scenarioPoints = model.scenario.daily
      .map((item, index) => `${xForIndex(index).toFixed(1)},${yForValue(item.balance).toFixed(1)}`)
      .join(" ");

    const zeroY = min <= 0 && max >= 0 ? yForValue(0) : null;

    return {
      width,
      height,
      left,
      top,
      bottom,
      plotWidth,
      baselinePoints,
      scenarioPoints,
      zeroY,
      xForIndex,
      yForValue,
    };
  }, [model, horizon]);

  function resetScenario() {
    setIncomeChangePct(0);
    setExpenseChangePct(0);
    setIncomeDelayDays(0);
    setMonthlyExpense("");
    setMonthlyExpenseStart(todayIso());
    setOneOffType("expense");
    setOneOffAmount("");
    setOneOffDate(todayIso());
  }

  function applyPreset(preset: "revenue-drop" | "expense-rise" | "delay" | "stress") {
    resetScenario();

    if (preset === "revenue-drop") {
      setIncomeChangePct(-10);
      return;
    }

    if (preset === "expense-rise") {
      setExpenseChangePct(10);
      return;
    }

    if (preset === "delay") {
      setIncomeDelayDays(15);
      return;
    }

    setIncomeChangePct(-15);
    setExpenseChangePct(15);
    setIncomeDelayDays(15);
  }

  if (loading) {
    return <section className="panel empty-state">Preparando simulador de cenários...</section>;
  }

  if (error) {
    return <div className="form-alert error page-alert">{error}</div>;
  }

  const riskWorsened =
    Boolean(model.scenario.firstNegativeDate) &&
    (!model.baseline.firstNegativeDate ||
      model.scenario.firstNegativeDate < model.baseline.firstNegativeDate);

  const scenarioIsNeutral =
    incomeChangePct === 0 &&
    expenseChangePct === 0 &&
    incomeDelayDays === 0 &&
    parseNumber(monthlyExpense) === 0 &&
    parseNumber(oneOffAmount) === 0;

  return (
    <div className="scenario-page">
      <section className="panel scenario-hero">
        <div>
          <span className="scenario-kicker">LABORATÓRIO FINANCEIRO</span>
          <h2>Simule decisões sem tocar nos dados reais</h2>
          <p>
            Compare o caixa atual com hipóteses de receita, despesa, atraso de recebimentos
            e novos compromissos.
          </p>
        </div>

        <div className="scenario-horizon">
          <span>Horizonte</span>
          <div>
            {([30, 60, 90] as Horizon[]).map((days) => (
              <button
                type="button"
                key={days}
                className={horizon === days ? "active" : ""}
                onClick={() => setHorizon(days)}
              >
                {days} dias
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="scenario-presets">
        <button type="button" onClick={() => applyPreset("revenue-drop")}>
          <strong>Receitas -10%</strong>
          <span>Queda moderada de faturamento</span>
        </button>
        <button type="button" onClick={() => applyPreset("expense-rise")}>
          <strong>Despesas +10%</strong>
          <span>Pressão de custos</span>
        </button>
        <button type="button" onClick={() => applyPreset("delay")}>
          <strong>Recebimentos +15 dias</strong>
          <span>Clientes pagando mais tarde</span>
        </button>
        <button type="button" onClick={() => applyPreset("stress")}>
          <strong>Cenário de estresse</strong>
          <span>Receitas -15%, despesas +15% e atraso</span>
        </button>
      </section>

      <section className="scenario-layout">
        <article className="panel scenario-controls-panel">
          <div className="panel-title">
            <div>
              <h2>Premissas do cenário</h2>
              <p>Ajuste as hipóteses e veja o efeito instantaneamente.</p>
            </div>
            <button className="ghost scenario-reset" type="button" onClick={resetScenario}>
              Limpar
            </button>
          </div>

          <div className="scenario-control-grid">
            <label>
              <span>Variação das receitas</span>
              <div className="scenario-number-input">
                <input
                  type="number"
                  min="-100"
                  max="300"
                  step="1"
                  value={incomeChangePct}
                  onChange={(event) => setIncomeChangePct(Number(event.target.value))}
                />
                <b>%</b>
              </div>
              <small>Ex.: -10 para queda de 10% ou 20 para crescimento de 20%.</small>
            </label>

            <label>
              <span>Variação das despesas</span>
              <div className="scenario-number-input">
                <input
                  type="number"
                  min="-100"
                  max="300"
                  step="1"
                  value={expenseChangePct}
                  onChange={(event) => setExpenseChangePct(Number(event.target.value))}
                />
                <b>%</b>
              </div>
              <small>Afeta todos os pagamentos pendentes dentro do horizonte.</small>
            </label>

            <label>
              <span>Atraso dos recebimentos</span>
              <div className="scenario-number-input">
                <input
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  value={incomeDelayDays}
                  onChange={(event) => setIncomeDelayDays(Math.max(0, Number(event.target.value)))}
                />
                <b>dias</b>
              </div>
              <small>Desloca as contas a receber para frente sem alterar o cadastro.</small>
            </label>

            <label>
              <span>Nova despesa mensal</span>
              <div className="scenario-money-input">
                <b>R$</b>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={monthlyExpense}
                  onChange={(event) => setMonthlyExpense(event.target.value)}
                />
              </div>
              <small>Útil para simular contratação, aluguel, software ou financiamento.</small>
            </label>

            <label>
              <span>Início da nova despesa</span>
              <input
                className="scenario-date-input"
                type="date"
                value={monthlyExpenseStart}
                onChange={(event) => setMonthlyExpenseStart(event.target.value)}
              />
              <small>Repete mensalmente até o fim do horizonte simulado.</small>
            </label>

            <div className="scenario-one-off">
              <span>Impacto pontual</span>
              <div className="scenario-one-off-row">
                <select
                  value={oneOffType}
                  onChange={(event) => setOneOffType(event.target.value as TransactionType)}
                >
                  <option value="expense">Saída</option>
                  <option value="income">Entrada</option>
                </select>
                <div className="scenario-money-input compact">
                  <b>R$</b>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={oneOffAmount}
                    onChange={(event) => setOneOffAmount(event.target.value)}
                  />
                </div>
                <input
                  className="scenario-date-input"
                  type="date"
                  value={oneOffDate}
                  onChange={(event) => setOneOffDate(event.target.value)}
                />
              </div>
              <small>Simule uma compra, investimento, venda ou aporte extraordinário.</small>
            </div>
          </div>
        </article>

        <article className="panel scenario-summary-panel">
          <div className="panel-title">
            <div>
              <h2>Impacto estimado</h2>
              <p>Comparação com a projeção normal do Valora.</p>
            </div>
          </div>

          <div className="scenario-summary-list">
            <div>
              <span>Saldo final base</span>
              <strong>{money.format(model.baseline.projectedBalance)}</strong>
            </div>
            <div>
              <span>Saldo final no cenário</span>
              <strong className={model.scenario.projectedBalance < 0 ? "negative-value" : "positive-value"}>
                {money.format(model.scenario.projectedBalance)}
              </strong>
            </div>
            <div className="scenario-impact-row">
              <span>Impacto líquido</span>
              <strong className={model.impact < 0 ? "negative-value" : "positive-value"}>
                {model.impact >= 0 ? "+" : ""}{money.format(model.impact)}
              </strong>
            </div>
            <div>
              <span>Menor saldo no cenário</span>
              <strong className={model.scenario.minimumBalance < 0 ? "negative-value" : ""}>
                {money.format(model.scenario.minimumBalance)}
              </strong>
              <small>{formatDate(model.scenario.minimumBalanceDate)}</small>
            </div>
          </div>
        </article>
      </section>

      <section
        className={
          "scenario-risk " +
          (model.scenario.firstNegativeDate
            ? "danger"
            : model.scenario.minimumBalance < Math.max(100, model.currentBalance * 0.15)
              ? "warning"
              : "healthy")
        }
      >
        <div className="scenario-risk-icon">
          {model.scenario.firstNegativeDate ? "!" : "✓"}
        </div>
        <div>
          <strong>
            {model.scenario.firstNegativeDate
              ? `O cenário leva o caixa ao negativo em ${formatDate(model.scenario.firstNegativeDate)}`
              : scenarioIsNeutral
                ? "Cenário igual à projeção atual"
                : "O caixa permanece positivo neste cenário"}
          </strong>
          <span>
            {riskWorsened
              ? "A hipótese antecipou ou criou um risco de liquidez que não existia no cenário-base."
              : model.scenario.firstNegativeDate
                ? "Revise as premissas ou planeje reserva de caixa antes desta data."
                : `Menor saldo estimado: ${money.format(model.scenario.minimumBalance)}.`}
          </span>
        </div>
      </section>

      <section className="panel scenario-chart-panel">
        <div className="panel-title scenario-chart-title">
          <div>
            <h2>Cenário-base × cenário simulado</h2>
            <p>
              Evolução do saldo de hoje até {formatDate(model.endDate)}.
            </p>
          </div>
          <div className="scenario-chart-legend">
            <span><i className="base" /> Base</span>
            <span><i className="simulated" /> Simulado</span>
          </div>
        </div>

        <div className="scenario-chart-scroll">
          <svg
            className="scenario-chart"
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            role="img"
            aria-label="Comparação entre projeção base e cenário financeiro simulado"
          >
            {chart.zeroY !== null && (
              <line
                x1={chart.left}
                y1={chart.zeroY}
                x2={chart.left + chart.plotWidth}
                y2={chart.zeroY}
                className="scenario-zero-line"
              />
            )}

            {[0, Math.floor(horizon / 4), Math.floor(horizon / 2), Math.floor((horizon * 3) / 4), horizon - 1]
              .filter((value, index, array) => array.indexOf(value) === index)
              .map((index) => {
                const x = chart.xForIndex(index);
                const date = addDaysIso(model.today, index);
                return (
                  <g key={date}>
                    <line
                      x1={x}
                      y1={chart.top}
                      x2={x}
                      y2={chart.bottom}
                      className="scenario-grid-line"
                    />
                    <text
                      x={x}
                      y="259"
                      textAnchor="middle"
                      className="scenario-chart-label"
                    >
                      {compactDate(date)}
                    </text>
                  </g>
                );
              })}

            <polyline
              points={chart.baselinePoints}
              fill="none"
              className="scenario-base-line"
            />
            <polyline
              points={chart.scenarioPoints}
              fill="none"
              className="scenario-simulated-line"
            />

            {model.scenario.firstNegativeDate && (
              <circle
                cx={chart.xForIndex(
                  Math.max(
                    0,
                    model.scenario.daily.findIndex(
                      (item) => item.date === model.scenario.firstNegativeDate,
                    ),
                  ),
                )}
                cy={chart.yForValue(
                  model.scenario.daily.find(
                    (item) => item.date === model.scenario.firstNegativeDate,
                  )?.balance ?? 0,
                )}
                r="5"
                className="scenario-danger-point"
              />
            )}
          </svg>
        </div>
      </section>

      <section className="scenario-comparison-grid">
        <article className="metric-card">
          <span>Entradas no cenário-base</span>
          <strong>{money.format(model.baseline.income)}</strong>
          <small>Dentro de {horizon} dias</small>
        </article>
        <article className="metric-card">
          <span>Entradas simuladas</span>
          <strong className={model.scenario.income < model.baseline.income ? "negative-value" : "positive-value"}>
            {money.format(model.scenario.income)}
          </strong>
          <small>{money.format(model.scenario.income - model.baseline.income)} de diferença</small>
        </article>
        <article className="metric-card">
          <span>Saídas no cenário-base</span>
          <strong>{money.format(model.baseline.expense)}</strong>
          <small>Dentro de {horizon} dias</small>
        </article>
        <article className="metric-card">
          <span>Saídas simuladas</span>
          <strong className={model.scenario.expense > model.baseline.expense ? "negative-value" : "positive-value"}>
            {money.format(model.scenario.expense)}
          </strong>
          <small>{money.format(model.scenario.expense - model.baseline.expense)} de diferença</small>
        </article>
      </section>

      <section className="scenario-footnote">
        <strong>Simulação isolada</strong>
        <span>
          Nenhuma premissa acima cria, edita ou exclui lançamentos. O cenário usa somente os dados
          financeiros já registrados para testar hipóteses.
          {model.unassigned > 0
            ? ` Existem ${model.unassigned} lançamento(s) pendente(s) sem conta definida, incluídos na visão consolidada.`
            : ""}
        </span>
      </section>
    </div>
  );
}
