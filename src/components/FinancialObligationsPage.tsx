
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type ObligationType = "income" | "expense";
type StatusFilter = "all" | "pending" | "paid" | "overdue";
type Account = { id: string; name: string };
type Category = { id: string; name: string; type: "income" | "expense" | "both" };
type CostCenter = { id: string; name: string };
type Transaction = {
  id: string;
  description: string;
  amount: number | string;
  status: "pending" | "paid" | "cancelled";
  due_date: string;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function parseMoney(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  if (clean.includes(",")) return Number(clean.replace(/\./g, "").replace(",", "."));
  return Number(clean);
}

export function FinancialObligationsPage({ type }: { type: ObligationType }) {
  const { activeCompany } = useCompany();
  const [items, setItems] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    description: "",
    amount: "",
    due_date: new Date().toISOString().slice(0, 10),
    status: "pending" as "pending" | "paid",
    account_id: "",
    category_id: "",
    cost_center_id: "",
  });

  const isExpense = type === "expense";
  const title = isExpense ? "Contas a pagar" : "Contas a receber";
  const itemLabel = isExpense ? "conta a pagar" : "conta a receber";
  const paidLabel = isExpense ? "Pago" : "Recebido";
  const actionLabel = isExpense ? "Marcar como pago" : "Marcar como recebido";

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);
    setError("");

    const [txResult, accountResult, categoryResult, costCenterResult] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, description, amount, status, due_date")
        .eq("company_id", activeCompany.id)
        .eq("type", type)
        .neq("status", "cancelled")
        .order("due_date", { ascending: true }),
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

    const firstError =
      txResult.error || accountResult.error || categoryResult.error || costCenterResult.error;

    if (firstError) {
      setError(firstError.message);
    } else {
      setItems((txResult.data ?? []) as Transaction[]);
      setAccounts((accountResult.data ?? []) as Account[]);
      setCategories((categoryResult.data ?? []) as Category[]);
      setCostCenters((costCenterResult.data ?? []) as CostCenter[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id, type]);

  const today = new Date().toISOString().slice(0, 10);

  const summary = useMemo(() => {
    const pending = items.filter((item) => item.status === "pending");
    const paid = items.filter((item) => item.status === "paid");
    const overdue = pending.filter((item) => item.due_date < today);
    return {
      pending: pending.reduce((sum, item) => sum + Number(item.amount), 0),
      paid: paid.reduce((sum, item) => sum + Number(item.amount), 0),
      overdue: overdue.reduce((sum, item) => sum + Number(item.amount), 0),
      pendingCount: pending.length,
      overdueCount: overdue.length,
    };
  }, [items, today]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "overdue") {
      return items.filter((item) => item.status === "pending" && item.due_date < today);
    }
    return items.filter((item) => item.status === filter);
  }, [filter, items, today]);

  const visibleCategories = categories.filter(
    (category) => category.type === type || category.type === "both",
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
      type,
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

  async function markAsPaid(item: Transaction) {
    if (!supabase) return;
    const { error: updateError } = await supabase
      .from("transactions")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", item.id);

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
          <h1>{title}</h1>
          <p>{isExpense ? "Acompanhe vencimentos, atrasos e pagamentos." : "Acompanhe valores previstos, atrasados e recebidos."}</p>
        </div>
        <button className="primary" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Nova " + itemLabel}
        </button>
      </header>

      <section className="compact-metrics">
        <article className="metric-card">
          <span>Pendente</span>
          <strong>{money.format(summary.pending)}</strong>
          <small>{summary.pendingCount} lançamento(s)</small>
        </article>
        <article className="metric-card">
          <span>Em atraso</span>
          <strong>{money.format(summary.overdue)}</strong>
          <small className={summary.overdueCount ? "danger-text" : ""}>{summary.overdueCount} vencido(s)</small>
        </article>
        <article className="metric-card">
          <span>{paidLabel}</span>
          <strong>{money.format(summary.paid)}</strong>
          <small>Histórico realizado</small>
        </article>
      </section>

      {showForm && (
        <form className="panel transaction-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>Nova {itemLabel}</h2>
              <p>O lançamento será refletido no dashboard automaticamente.</p>
            </div>
          </div>
          <div className="form-grid obligations-form-grid">
            <label className="wide">
              Descrição
              <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
            </label>
            <label>
              Valor
              <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0,00" inputMode="decimal" required />
            </label>
            <label>
              Vencimento
              <input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} required />
            </label>
            <label>
              Status
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "pending" | "paid" })}>
                <option value="pending">Pendente</option>
                <option value="paid">{paidLabel}</option>
              </select>
            </label>
            <label>
              Conta / caixa
              <select value={form.account_id} onChange={(event) => setForm({ ...form, account_id: event.target.value })}>
                <option value="">Sem conta</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
            <label>
              Categoria
              <select value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
                <option value="">Sem categoria</option>
                {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label>
              Centro de custo
              <select value={form.cost_center_id} onChange={(event) => setForm({ ...form, cost_center_id: event.target.value })}>
                <option value="">Sem centro de custo</option>
                {costCenters.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
              </select>
            </label>
          </div>
          {error && <div className="form-alert error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="primary" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
          </div>
        </form>
      )}

      {!showForm && error && <div className="form-alert error page-alert">{error}</div>}

      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {(["pending", "overdue", "paid", "all"] as StatusFilter[]).map((value) => (
              <button key={value} className={filter === value ? "filter-tab active" : "filter-tab"} onClick={() => setFilter(value)}>
                {value === "pending" ? "Pendentes" : value === "overdue" ? "Em atraso" : value === "paid" ? paidLabel : "Todas"}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Carregando...</div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state"><strong>Nenhum lançamento nesta visão.</strong><span>Os próximos registros aparecerão aqui.</span></div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Descrição</th><th>Vencimento</th><th>Status</th><th className="right">Valor</th><th></th></tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const overdue = item.status === "pending" && item.due_date < today;
                  return (
                    <tr key={item.id}>
                      <td><strong>{item.description}</strong></td>
                      <td>{new Date(item.due_date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                      <td><span className={overdue ? "pill overdue" : "pill " + item.status}>{overdue ? "Em atraso" : item.status === "paid" ? paidLabel : "Pendente"}</span></td>
                      <td className={"right amount " + type}>{money.format(Number(item.amount))}</td>
                      <td className="right">{item.status === "pending" && <button className="table-action" onClick={() => void markAsPaid(item)}>{actionLabel}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
