import { useMemo, useState } from "react";

type AccountKind = "cash" | "checking" | "savings" | "wallet" | "other";

export type StatementAccount = {
  id: string;
  name: string;
  kind: AccountKind;
  opening_balance: number | string;
  active: boolean;
};

export type StatementTransaction = {
  id: string;
  description: string;
  amount: number | string;
  type: "income" | "expense";
  due_date: string;
  paid_at: string | null;
  account_id: string | null;
};

type Props = {
  account: StatementAccount;
  transactions: StatementTransaction[];
  currentBalance: number;
  onBack: () => void;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const kindLabels: Record<AccountKind, string> = {
  cash: "Caixa",
  checking: "Conta corrente",
  savings: "Poupança",
  wallet: "Carteira",
  other: "Outra",
};

function transactionDate(transaction: StatementTransaction) {
  return transaction.paid_at?.slice(0, 10) || transaction.due_date;
}

function csvCell(value: string) {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function AccountStatementView({
  account,
  transactions,
  currentBalance,
  onBack,
}: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const accountTransactions = useMemo(
    () =>
      transactions
        .filter((transaction) => transaction.account_id === account.id)
        .slice()
        .sort((a, b) => {
          const dateCompare = transactionDate(a).localeCompare(transactionDate(b));
          if (dateCompare !== 0) return dateCompare;
          return a.id.localeCompare(b.id);
        }),
    [account.id, transactions],
  );

  const runningBalances = useMemo(() => {
    const balances = new Map<string, number>();
    let running = Number(account.opening_balance ?? 0);

    for (const transaction of accountTransactions) {
      const amount = Number(transaction.amount);
      running += transaction.type === "income" ? amount : -amount;
      balances.set(transaction.id, running);
    }

    return balances;
  }, [account.opening_balance, accountTransactions]);

  const balanceBeforePeriod = useMemo(() => {
    if (!startDate) return Number(account.opening_balance ?? 0);

    return accountTransactions.reduce((balance, transaction) => {
      if (transactionDate(transaction) >= startDate) return balance;
      const amount = Number(transaction.amount);
      return balance + (transaction.type === "income" ? amount : -amount);
    }, Number(account.opening_balance ?? 0));
  }, [account.opening_balance, accountTransactions, startDate]);

  const periodTransactions = useMemo(
    () =>
      accountTransactions.filter((transaction) => {
        const date = transactionDate(transaction);
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
      }),
    [accountTransactions, startDate, endDate],
  );

  const filteredTransactions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");

    return periodTransactions.filter((transaction) => {
      if (typeFilter !== "all" && transaction.type !== typeFilter) return false;
      if (
        normalizedSearch &&
        !transaction.description.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
      ) {
        return false;
      }
      return true;
    });
  }, [periodTransactions, search, typeFilter]);

  const periodTotals = useMemo(
    () =>
      periodTransactions.reduce(
        (totals, transaction) => {
          const amount = Number(transaction.amount);
          if (transaction.type === "income") totals.income += amount;
          else totals.expense += amount;
          return totals;
        },
        { income: 0, expense: 0 },
      ),
    [periodTransactions],
  );

  const hasFilters = Boolean(search || startDate || endDate || typeFilter !== "all");

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setStartDate("");
    setEndDate("");
  }

  function exportCsv() {
    if (!filteredTransactions.length) return;

    const header = [
      "Data",
      "Descrição",
      "Tipo",
      "Entrada",
      "Saída",
      "Saldo após lançamento",
    ];

    const rows = filteredTransactions.map((transaction) => {
      const amount = Number(transaction.amount);
      const balance = runningBalances.get(transaction.id) ?? 0;

      return [
        new Date(transactionDate(transaction) + "T12:00:00").toLocaleDateString("pt-BR"),
        transaction.description,
        transaction.type === "income" ? "Receita" : "Despesa",
        transaction.type === "income" ? amount.toFixed(2).replace(".", ",") : "",
        transaction.type === "expense" ? amount.toFixed(2).replace(".", ",") : "",
        balance.toFixed(2).replace(".", ","),
      ]
        .map((value) => csvCell(String(value)))
        .join(";");
    });

    const content = "\uFEFF" + [header.map(csvCell).join(";"), ...rows].join("\r\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const period =
      startDate || endDate
        ? `-${startDate || "inicio"}-a-${endDate || "hoje"}`
        : "";

    link.href = url;
    link.download = `extrato-${safeFileName(account.name) || "conta"}${period}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="page-header split account-statement-page-header">
        <div>
          <button type="button" className="account-statement-back" onClick={onBack}>
            ← Voltar para contas e caixas
          </button>
          <p className="eyebrow">EXTRATO DA CONTA</p>
          <h1>{account.name}</h1>
          <p>
            {kindLabels[account.kind]} • histórico de movimentações pagas e recebidas.
          </p>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={exportCsv}
          disabled={filteredTransactions.length === 0}
        >
          Exportar CSV
        </button>
      </header>

      <section className="account-statement-summary">
        <article className="account-statement-balance-card">
          <span>Saldo atual</span>
          <strong>{money.format(currentBalance)}</strong>
          <small>
            Saldo inicial de {money.format(Number(account.opening_balance ?? 0))} + movimentações
          </small>
        </article>

        <article>
          <span>Entradas no período</span>
          <strong className="income">+ {money.format(periodTotals.income)}</strong>
          <small>{periodTransactions.filter((item) => item.type === "income").length} receitas</small>
        </article>

        <article>
          <span>Saídas no período</span>
          <strong className="expense">− {money.format(periodTotals.expense)}</strong>
          <small>{periodTransactions.filter((item) => item.type === "expense").length} despesas</small>
        </article>

        <article>
          <span>Saldo inicial do período</span>
          <strong>{money.format(balanceBeforePeriod)}</strong>
          <small>{startDate ? "Antes da primeira data filtrada" : "Saldo inicial cadastrado"}</small>
        </article>
      </section>

      <section className="panel account-statement-filters">
        <div className="account-statement-filter-grid">
          <label className="account-statement-search">
            Buscar
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Descrição do lançamento"
            />
          </label>

          <label>
            Tipo
            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as "all" | "income" | "expense")
              }
            >
              <option value="all">Todos</option>
              <option value="income">Receitas</option>
              <option value="expense">Despesas</option>
            </select>
          </label>

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
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>

          <button
            type="button"
            className="ghost"
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <section className="panel table-panel account-statement-table-panel">
        {filteredTransactions.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma movimentação encontrada.</strong>
            <span>
              {accountTransactions.length === 0
                ? "Esta conta ainda não possui lançamentos pagos ou recebidos."
                : "Ajuste os filtros para visualizar outras movimentações."}
            </span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="account-statement-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th className="right">Movimentação</th>
                  <th className="right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions
                  .slice()
                  .reverse()
                  .map((transaction) => {
                    const amount = Number(transaction.amount);
                    const balance = runningBalances.get(transaction.id) ?? 0;

                    return (
                      <tr key={transaction.id}>
                        <td>
                          {new Date(
                            transactionDate(transaction) + "T12:00:00",
                          ).toLocaleDateString("pt-BR")}
                        </td>
                        <td>
                          <strong>{transaction.description}</strong>
                        </td>
                        <td>
                          <span className={`pill ${transaction.type}`}>
                            {transaction.type === "income" ? "Receita" : "Despesa"}
                          </span>
                        </td>
                        <td className={`right amount ${transaction.type}`}>
                          {transaction.type === "income" ? "+" : "−"} {money.format(amount)}
                        </td>
                        <td className="right account-running-balance">
                          {money.format(balance)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="account-statement-footnote">
        O saldo considera apenas movimentações pagas/recebidas vinculadas a esta conta.
        Lançamentos pendentes não alteram o extrato.
      </p>
    </>
  );
}
