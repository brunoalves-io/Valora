import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

type Transaction = {
  id: string;
  description: string;
  amount: number | string;
  type: "income" | "expense";
  status: "pending" | "paid";
  due_date: string;
  paid_at: string | null;
};

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{money.format(value)}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function Dashboard({ onOpenAI }: { onOpenAI: () => void }) {
  const { activeCompany } = useCompany();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !activeCompany) {
      setLoading(false);
      return;
    }

    const client = supabase;
    const companyId = activeCompany.id;

    async function load() {
      setLoading(true);
      const [txResult, accountsResult] = await Promise.all([
        client
          .from("transactions")
          .select("id, description, amount, type, status, due_date, paid_at")
          .eq("company_id", companyId)
          .order("due_date", { ascending: true }),
        client
          .from("financial_accounts")
          .select("opening_balance")
          .eq("company_id", companyId)
          .eq("active", true),
      ]);

      if (!txResult.error) setTransactions((txResult.data ?? []) as Transaction[]);
      if (!accountsResult.error) {
        setOpeningBalance(
          (accountsResult.data ?? []).reduce(
            (sum, account) => sum + Number(account.opening_balance ?? 0),
            0,
          ),
        );
      }
      setLoading(false);
    }

    void load();
  }, [activeCompany?.id]);

  const summary = useMemo(() => {
    const paid = transactions.filter((item) => item.status === "paid");
    const balance =
      openingBalance +
      paid.reduce(
        (sum, item) =>
          sum + (item.type === "income" ? Number(item.amount) : -Number(item.amount)),
        0,
      );
    const receivable = transactions
      .filter((item) => item.status === "pending" && item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const payable = transactions
      .filter((item) => item.status === "pending" && item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthPaid = paid.filter((item) => item.paid_at?.startsWith(monthPrefix));
    const monthIncome = monthPaid
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const monthExpense = monthPaid
      .filter((item) => item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    return {
      balance,
      receivable,
      payable,
      monthIncome,
      monthExpense,
      monthResult: monthIncome - monthExpense,
    };
  }, [openingBalance, transactions]);

  const upcoming = transactions
    .filter((item) => item.status === "pending" && item.type === "expense")
    .slice(0, 4);

  const chart = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const label = date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
      const total = transactions
        .filter((item) => item.status === "paid" && item.paid_at?.startsWith(key))
        .reduce(
          (sum, item) =>
            sum + (item.type === "income" ? Number(item.amount) : -Number(item.amount)),
          0,
        );
      return { label, total };
    });
    const max = Math.max(...months.map((month) => Math.abs(month.total)), 1);
    return months.map((month) => ({
      ...month,
      height: Math.max(8, (Math.abs(month.total) / max) * 100),
    }));
  }, [transactions]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">VISÃO GERAL</p>
          <h1>{activeCompany?.name}</h1>
          <p>Um retrato financeiro construído com os lançamentos reais da empresa.</p>
        </div>
      </header>

      {loading ? (
        <div className="panel empty-state">Carregando painel financeiro...</div>
      ) : (
        <>
          <section className="metrics">
            <Metric label="Saldo atual" value={summary.balance} detail="Movimentações pagas" />
            <Metric label="A receber" value={summary.receivable} detail="Lançamentos pendentes" />
            <Metric label="A pagar" value={summary.payable} detail="Lançamentos pendentes" />
            <Metric
              label="Resultado do mês"
              value={summary.monthResult}
              detail="Receitas pagas − despesas pagas"
            />
          </section>

          <section className="grid">
            <article className="panel chart-panel">
              <div className="panel-title">
                <div>
                  <h2>Fluxo de caixa</h2>
                  <p>Resultado realizado nos últimos 6 meses</p>
                </div>
              </div>
              <div className="chart">
                {chart.map((month) => (
                  <div className="bar-wrap" key={month.label}>
                    <div
                      className={`bar ${month.total < 0 ? "negative" : ""}`}
                      style={{ height: `${month.height}%` }}
                      title={money.format(month.total)}
                    />
                    <span>{month.label}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-title">
                <div>
                  <h2>Próximos vencimentos</h2>
                  <p>Despesas pendentes mais próximas</p>
                </div>
              </div>
              <div className="due-list">
                {upcoming.length === 0 && (
                  <div className="empty-inline">Nenhuma despesa pendente.</div>
                )}
                {upcoming.map((item) => (
                  <div className="due-row" key={item.id}>
                    <span className="status-dot warning" />
                    <div>
                      <strong>{item.description}</strong>
                      <small>
                        {new Date(item.due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                      </small>
                    </div>
                    <b>{money.format(Number(item.amount))}</b>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel summary">
              <div className="panel-title">
                <div>
                  <h2>Receitas x despesas</h2>
                  <p>Mês atual, regime de caixa</p>
                </div>
              </div>
              <div className="summary-row">
                <span>Receitas</span><strong>{money.format(summary.monthIncome)}</strong>
              </div>
              <div className="progress"><i style={{ width: summary.monthIncome ? "78%" : "0%" }} /></div>
              <div className="summary-row">
                <span>Despesas</span><strong>{money.format(summary.monthExpense)}</strong>
              </div>
              <div className="progress muted"><i style={{ width: summary.monthExpense ? "57%" : "0%" }} /></div>
              <div className="result-line">
                <span>Resultado</span><strong>{money.format(summary.monthResult)}</strong>
              </div>
            </article>

            <article className="panel ai-panel">
              <div className="ai-icon">✦</div>
              <div>
                <h2>Valora IA</h2>
                <p>Converse com os números da empresa e transforme dados em próximos passos.</p>
              </div>
              <div className="ask">
                <div className="ai-dashboard-example">
                  Ex.: “Como está meu caixa nos próximos 30 dias?”
                </div>
                <button className="primary" onClick={onOpenAI}>
                  Abrir Valora IA
                </button>
              </div>
            </article>
          </section>
        </>
      )}
    </>
  );
}
