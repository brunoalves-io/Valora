import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type Account = { id: string; name: string };
type Category = { id: string; name: string; type: "income" | "expense" | "both" };
type CostCenter = { id: string; name: string };
type Transaction = {
  id: string;
  description: string;
  amount: number | string;
  type: "income" | "expense";
  status: "pending" | "paid";
  due_date: string;
  account_id: string | null;
  category_id: string | null;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function parseMoney(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  if (clean.includes(",")) return Number(clean.replace(/\./g, "").replace(",", "."));
  return Number(clean);
}

export function TransactionsPage() {
  const { activeCompany } = useCompany();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: "expense" as "income" | "expense",
    description: "",
    amount: "",
    due_date: new Date().toISOString().slice(0, 10),
    status: "pending" as "pending" | "paid",
    account_id: "",
    category_id: "",
    cost_center_id: "",
  });

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);

    const [txResult, accountResult, categoryResult, costCenterResult] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, description, amount, type, status, due_date, account_id, category_id")
        .eq("company_id", activeCompany.id)
        .order("due_date", { ascending: false })
        .limit(100),
      supabase
        .from("financial_accounts")
        .select("id, name")
        .eq("company_id", activeCompany.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("categories")
        .select("id, name, type")
        .eq("company_id", activeCompany.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("cost_centers")
        .select("id, name")
        .eq("company_id", activeCompany.id)
        .eq("active", true)
        .order("name"),
    ]);

    if (txResult.error || accountResult.error || categoryResult.error || costCenterResult.error) {
      setError(
        txResult.error?.message ||
          accountResult.error?.message ||
          categoryResult.error?.message ||
          costCenterResult.error?.message ||
          "Erro ao carregar dados.",
      );
    } else {
      setTransactions((txResult.data ?? []) as Transaction[]);
      setAccounts((accountResult.data ?? []) as Account[]);
      setCategories((categoryResult.data ?? []) as Category[]);
      setCostCenters((costCenterResult.data ?? []) as CostCenter[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  const visibleCategories = useMemo(
    () => categories.filter((item) => item.type === form.type || item.type === "both"),
    [categories, form.type],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    const amount = parseMoney(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Informe um valor válido.");
      return;
    }

    setSaving(true);
    setError("");

    const { error: insertError } = await supabase.from("transactions").insert({
      company_id: activeCompany.id,
      type: form.type,
      description: form.description.trim(),
      amount,
      due_date: form.due_date,
      status: form.status,
      paid_at: form.status === "paid" ? new Date().toISOString() : null,
      account_id: form.account_id || null,
      category_id: form.category_id || null,
      cost_center_id: form.cost_center_id || null,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setForm({
      type: "expense",
      description: "",
      amount: "",
      due_date: new Date().toISOString().slice(0, 10),
      status: "pending",
      account_id: accounts[0]?.id ?? "",
      category_id: "",
      cost_center_id: "",
    });
    setShowForm(false);
    setSaving(false);
    await load();
  }

  return (
    <>
      <header className="page-header split">
        <div>
          <p className="eyebrow">FINANCEIRO</p>
          <h1>Lançamentos</h1>
          <p>Receitas e despesas da empresa em um único histórico.</p>
        </div>
        <button className="primary" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Novo lançamento"}
        </button>
      </header>

      {showForm && (
        <form className="panel transaction-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>Novo lançamento</h2>
              <p>Cadastre uma receita ou despesa.</p>
            </div>
            <div className="type-toggle">
              <button
                type="button"
                className={form.type === "expense" ? "selected expense" : ""}
                onClick={() => setForm({ ...form, type: "expense", category_id: "" })}
              >
                Despesa
              </button>
              <button
                type="button"
                className={form.type === "income" ? "selected income" : ""}
                onClick={() => setForm({ ...form, type: "income", category_id: "" })}
              >
                Receita
              </button>
            </div>
          </div>

          <div className="form-grid">
            <label className="wide">
              Descrição
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Ex.: Pagamento fornecedor"
                required
              />
            </label>
            <label>
              Valor
              <input
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                placeholder="0,00"
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Vencimento
              <input
                type="date"
                value={form.due_date}
                onChange={(event) => setForm({ ...form, due_date: event.target.value })}
                required
              />
            </label>
            <label>
              Status
              <select
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value as "pending" | "paid" })
                }
              >
                <option value="pending">Pendente</option>
                <option value="paid">Pago / recebido</option>
              </select>
            </label>
            <label>
              Conta
              <select
                value={form.account_id}
                onChange={(event) => setForm({ ...form, account_id: event.target.value })}
              >
                <option value="">Sem conta</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>
            <label>
              Categoria
              <select
                value={form.category_id}
                onChange={(event) => setForm({ ...form, category_id: event.target.value })}
              >
                <option value="">Sem categoria</option>
                {visibleCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              Centro de custo
              <select
                value={form.cost_center_id}
                onChange={(event) => setForm({ ...form, cost_center_id: event.target.value })}
              >
                <option value="">Sem centro de custo</option>
                {costCenters.map((center) => (
                  <option key={center.id} value={center.id}>{center.name}</option>
                ))}
              </select>
            </label>
          </div>

          {error && <div className="form-alert error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
            <button className="primary" disabled={saving}>
              {saving ? "Salvando..." : "Salvar lançamento"}
            </button>
          </div>
        </form>
      )}

      {!showForm && error && <div className="form-alert error page-alert">{error}</div>}

      <section className="panel table-panel">
        {loading ? (
          <div className="empty-state">Carregando lançamentos...</div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhum lançamento ainda.</strong>
            <span>Cadastre a primeira receita ou despesa para alimentar o painel.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Vencimento</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th className="right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.description}</strong></td>
                    <td>{new Date(item.due_date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                    <td>
                      <span className={`pill ${item.type}`}>
                        {item.type === "income" ? "Receita" : "Despesa"}
                      </span>
                    </td>
                    <td>{item.status === "paid" ? "Pago" : "Pendente"}</td>
                    <td className={`right amount ${item.type}`}>
                      {item.type === "income" ? "+" : "−"} {money.format(Number(item.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
