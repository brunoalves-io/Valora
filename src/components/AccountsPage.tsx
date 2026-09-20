
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type AccountKind = "cash" | "checking" | "savings" | "wallet" | "other";
type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  opening_balance: number | string;
  active: boolean;
};
type Transaction = {
  id: string;
  amount: number | string;
  type: "income" | "expense";
  account_id: string | null;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const kindLabels: Record<AccountKind, string> = {
  cash: "Caixa",
  checking: "Conta corrente",
  savings: "Poupança",
  wallet: "Carteira",
  other: "Outra",
};

function parseMoney(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return 0;
  if (clean.includes(",")) return Number(clean.replace(/\./g, "").replace(",", "."));
  return Number(clean);
}

export function AccountsPage() {
  const { activeCompany } = useCompany();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    kind: "checking" as AccountKind,
    opening_balance: "0,00",
  });

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);
    setError("");

    const [accountResult, txResult] = await Promise.all([
      supabase
        .from("financial_accounts")
        .select("id, name, kind, opening_balance, active")
        .eq("company_id", activeCompany.id)
        .order("active", { ascending: false })
        .order("name"),
      supabase
        .from("transactions")
        .select("id, amount, type, account_id")
        .eq("company_id", activeCompany.id)
        .eq("status", "paid"),
    ]);

    if (accountResult.error || txResult.error) {
      setError(accountResult.error?.message || txResult.error?.message || "Erro ao carregar contas.");
    } else {
      setAccounts((accountResult.data ?? []) as Account[]);
      setTransactions((txResult.data ?? []) as Transaction[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  const balances = useMemo(() => {
    const result = new Map<string, number>();
    for (const account of accounts) result.set(account.id, Number(account.opening_balance ?? 0));
    for (const tx of transactions) {
      if (!tx.account_id) continue;
      const current = result.get(tx.account_id) ?? 0;
      const amount = Number(tx.amount);
      result.set(tx.account_id, current + (tx.type === "income" ? amount : -amount));
    }
    return result;
  }, [accounts, transactions]);

  const totalBalance = accounts
    .filter((account) => account.active)
    .reduce((sum, account) => sum + (balances.get(account.id) ?? 0), 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    const openingBalance = parseMoney(form.opening_balance);
    if (!Number.isFinite(openingBalance)) {
      setError("Informe um saldo inicial válido.");
      return;
    }

    setSaving(true);
    setError("");

    const { error: insertError } = await supabase.from("financial_accounts").insert({
      company_id: activeCompany.id,
      name: form.name.trim(),
      kind: form.kind,
      opening_balance: openingBalance,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setForm({ name: "", kind: "checking", opening_balance: "0,00" });
    setShowForm(false);
    setSaving(false);
    await load();
  }

  async function toggleActive(account: Account) {
    if (!supabase) return;
    const { error: updateError } = await supabase
      .from("financial_accounts")
      .update({ active: !account.active })
      .eq("id", account.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    await load();
  }

  return (
    <>
      <header className="page-header split">
        <div>
          <p className="eyebrow">FINANCEIRO</p>
          <h1>Contas e caixas</h1>
          <p>Organize onde o dinheiro da empresa entra, sai e permanece.</p>
        </div>
        <button className="primary" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Nova conta"}
        </button>
      </header>

      <section className="account-total-card">
        <span>Saldo consolidado das contas ativas</span>
        <strong>{money.format(totalBalance)}</strong>
        <small>Saldo inicial + movimentações pagas e recebidas</small>
      </section>

      {showForm && (
        <form className="panel simple-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>Nova conta ou caixa</h2>
              <p>Use contas manuais nesta fase, sem conexão bancária.</p>
            </div>
          </div>
          <div className="simple-form-grid">
            <label>
              Nome
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Banco principal" required />
            </label>
            <label>
              Tipo
              <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as AccountKind })}>
                {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Saldo inicial
              <input value={form.opening_balance} onChange={(event) => setForm({ ...form, opening_balance: event.target.value })} inputMode="decimal" />
            </label>
          </div>
          {error && <div className="form-alert error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="primary" disabled={saving}>{saving ? "Salvando..." : "Salvar conta"}</button>
          </div>
        </form>
      )}

      {!showForm && error && <div className="form-alert error page-alert">{error}</div>}

      {loading ? (
        <section className="panel empty-state">Carregando contas...</section>
      ) : (
        <section className="account-grid">
          {accounts.map((account) => (
            <article className={account.active ? "account-card" : "account-card inactive"} key={account.id}>
              <div className="account-card-top">
                <div className="account-symbol">◉</div>
                <span className={account.active ? "status-badge active" : "status-badge"}>{account.active ? "Ativa" : "Inativa"}</span>
              </div>
              <small>{kindLabels[account.kind]}</small>
              <h2>{account.name}</h2>
              <strong>{money.format(balances.get(account.id) ?? 0)}</strong>
              <div className="account-card-footer">
                <span>Inicial: {money.format(Number(account.opening_balance))}</span>
                <button className="table-action" onClick={() => void toggleActive(account)}>{account.active ? "Desativar" : "Reativar"}</button>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
