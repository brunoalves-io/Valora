
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import { getDeleteErrorMessage } from "../lib/deleteErrors";

type RuleType = "income" | "expense";
type Frequency = "weekly" | "monthly" | "yearly";

type RecurringRule = {
  id: string;
  type: RuleType;
  description: string;
  amount: number | string;
  frequency: Frequency;
  interval_count: number;
  start_date: string;
  end_date: string | null;
  next_due_date: string;
  account_id: string | null;
  category_id: string | null;
  cost_center_id: string | null;
  partner_id: string | null;
  active: boolean;
};

type Named = { id: string; name: string };
type Category = { id: string; name: string; type: "income" | "expense" | "both" };
type Partner = {
  id: string;
  name: string;
  kind: "customer" | "supplier" | "both";
  active: boolean;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const frequencyLabels: Record<Frequency, string> = {
  weekly: "Semanal",
  monthly: "Mensal",
  yearly: "Anual",
};

function parseMoney(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return 0;
  if (clean.includes(",")) return Number(clean.replace(/\./g, "").replace(",", "."));
  return Number(clean);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function horizonIso(days = 90) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function RecurrencesPage() {
  const { activeCompany } = useCompany();
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [accounts, setAccounts] = useState<Named[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<Named[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RecurringRule | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    type: "expense" as RuleType,
    description: "",
    amount: "",
    frequency: "monthly" as Frequency,
    interval_count: "1",
    start_date: todayIso(),
    end_date: "",
    account_id: "",
    category_id: "",
    cost_center_id: "",
    partner_id: "",
  });

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);
    setError("");

    const [ruleResult, accountResult, categoryResult, costCenterResult, partnerResult] =
      await Promise.all([
        supabase
          .from("recurring_rules")
          .select(
            "id, type, description, amount, frequency, interval_count, start_date, end_date, next_due_date, account_id, category_id, cost_center_id, partner_id, active",
          )
          .eq("company_id", activeCompany.id)
          .order("active", { ascending: false })
          .order("next_due_date"),
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
        supabase
          .from("business_partners")
          .select("id, name, kind, active")
          .eq("company_id", activeCompany.id)
          .order("name"),
      ]);

    const firstError =
      ruleResult.error ||
      accountResult.error ||
      categoryResult.error ||
      costCenterResult.error ||
      partnerResult.error;

    if (firstError) {
      setError(firstError.message);
    } else {
      setRules((ruleResult.data ?? []) as RecurringRule[]);
      setAccounts((accountResult.data ?? []) as Named[]);
      setCategories((categoryResult.data ?? []) as Category[]);
      setCostCenters((costCenterResult.data ?? []) as Named[]);
      setPartners((partnerResult.data ?? []) as Partner[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  const visibleCategories = categories.filter(
    (category) => category.type === form.type || category.type === "both",
  );

  const visiblePartners = partners.filter(
    (partner) =>
      partner.active &&
      (partner.kind === "both" ||
        (form.type === "income" && partner.kind === "customer") ||
        (form.type === "expense" && partner.kind === "supplier")),
  );

  const categoryNames = useMemo(
    () => new Map(categories.map((item) => [item.id, item.name])),
    [categories],
  );
  const costCenterNames = useMemo(
    () => new Map(costCenters.map((item) => [item.id, item.name])),
    [costCenters],
  );
  const partnerNames = useMemo(
    () => new Map(partners.map((item) => [item.id, item.name])),
    [partners],
  );

  const summary = useMemo(() => {
    const activeRules = rules.filter((rule) => rule.active);
    const monthlyExpense = activeRules
      .filter(
        (rule) =>
          rule.type === "expense" &&
          rule.frequency === "monthly" &&
          rule.interval_count === 1,
      )
      .reduce((sum, rule) => sum + Number(rule.amount), 0);
    const monthlyIncome = activeRules
      .filter(
        (rule) =>
          rule.type === "income" &&
          rule.frequency === "monthly" &&
          rule.interval_count === 1,
      )
      .reduce((sum, rule) => sum + Number(rule.amount), 0);

    return {
      active: activeRules.length,
      monthlyIncome,
      monthlyExpense,
    };
  }, [rules]);

  function resetForm() {
    setForm({
      type: "expense",
      description: "",
      amount: "",
      frequency: "monthly",
      interval_count: "1",
      start_date: todayIso(),
      end_date: "",
      account_id: "",
      category_id: "",
      cost_center_id: "",
      partner_id: "",
    });
    setEditingId(null);
    setShowForm(false);
    setError("");
  }

  function openNewRule() {
    setEditingId(null);
    setForm({
      type: "expense",
      description: "",
      amount: "",
      frequency: "monthly",
      interval_count: "1",
      start_date: todayIso(),
      end_date: "",
      account_id: "",
      category_id: "",
      cost_center_id: "",
      partner_id: "",
    });
    setError("");
    setShowForm(true);
  }

  function editRule(rule: RecurringRule) {
    setEditingId(rule.id);
    setForm({
      type: rule.type,
      description: rule.description,
      amount: String(rule.amount).replace(".", ","),
      frequency: rule.frequency,
      interval_count: String(rule.interval_count),
      start_date: rule.start_date,
      end_date: rule.end_date ?? "",
      account_id: rule.account_id ?? "",
      category_id: rule.category_id ?? "",
      cost_center_id: rule.cost_center_id ?? "",
      partner_id: rule.partner_id ?? "",
    });
    setError("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function syncForecast() {
    if (!supabase || !activeCompany) return;
    setSyncing(true);
    setError("");

    const { error: rpcError } = await supabase.rpc("materialize_recurring_transactions", {
      p_company_id: activeCompany.id,
      p_through_date: horizonIso(90),
    });

    if (rpcError) setError(rpcError.message);
    setSyncing(false);
    await load();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    const amount = parseMoney(form.amount);
    const intervalCount = Number(form.interval_count);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Informe um valor válido.");
      return;
    }
    if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 24) {
      setError("O intervalo deve estar entre 1 e 24.");
      return;
    }
    if (form.end_date && form.end_date < form.start_date) {
      setError("A data final não pode ser anterior ao início.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      type: form.type,
      description: form.description.trim(),
      amount,
      frequency: form.frequency,
      interval_count: intervalCount,
      start_date: form.start_date,
      end_date: form.end_date || null,
      account_id: form.account_id || null,
      category_id: form.category_id || null,
      cost_center_id: form.cost_center_id || null,
      partner_id: form.partner_id || null,
    };

    const currentRule = editingId
      ? rules.find((rule) => rule.id === editingId)
      : null;

    const mutation = editingId
      ? supabase
          .from("recurring_rules")
          .update({
            ...payload,
            next_due_date:
              currentRule && currentRule.next_due_date > form.start_date
                ? currentRule.next_due_date
                : form.start_date,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingId)
          .eq("company_id", activeCompany.id)
      : supabase.from("recurring_rules").insert({
          company_id: activeCompany.id,
          ...payload,
          next_due_date: form.start_date,
        });

    const { error: mutationError } = await mutation;

    if (mutationError) {
      setError(
        editingId
          ? "Não foi possível atualizar esta recorrência."
          : mutationError.message,
      );
      setSaving(false);
      return;
    }

    setSaving(false);
    resetForm();
    await syncForecast();
  }

  function requestDeleteRule(rule: RecurringRule) {
    if (deletingId) return;
    setPendingDelete(rule);
  }

  async function confirmDeleteRule() {
    if (!supabase || !activeCompany || !pendingDelete || deletingId) return;
    const rule = pendingDelete;
    setDeletingId(rule.id);
    setError("");

    const { error: deleteError } = await supabase
      .from("recurring_rules")
      .delete()
      .eq("id", rule.id)
      .eq("company_id", activeCompany.id);

    if (deleteError) {
      setError(getDeleteErrorMessage(deleteError, "esta recorrência"));
      setDeletingId(null);
      setPendingDelete(null);
      return;
    }

    setDeletingId(null);
    setPendingDelete(null);
    await load();
  }

  async function toggleRule(rule: RecurringRule) {
    if (!supabase) return;

    const { error: updateError } = await supabase
      .from("recurring_rules")
      .update({
        active: !rule.active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rule.id);

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
          <p className="eyebrow">AUTOMAÇÃO FINANCEIRA</p>
          <h1>Recorrências</h1>
          <p>Transforme despesas e receitas repetitivas em previsões automáticas.</p>
        </div>
        <div className="header-actions">
          <button className="ghost" onClick={() => void syncForecast()} disabled={syncing}>
            {syncing ? "Atualizando..." : "Atualizar 90 dias"}
          </button>
          <button
            className="primary"
            onClick={() => {
              if (showForm) resetForm();
              else openNewRule();
            }}
          >
            {showForm ? "Fechar" : "+ Nova recorrência"}
          </button>
        </div>
      </header>

      <section className="compact-metrics">
        <article className="metric-card">
          <span>Recorrências ativas</span>
          <strong>{summary.active}</strong>
          <small>Regras em execução</small>
        </article>
        <article className="metric-card">
          <span>Receitas mensais fixas</span>
          <strong>{money.format(summary.monthlyIncome)}</strong>
          <small>Regras mensais de 1 em 1 mês</small>
        </article>
        <article className="metric-card">
          <span>Despesas mensais fixas</span>
          <strong>{money.format(summary.monthlyExpense)}</strong>
          <small>Regras mensais de 1 em 1 mês</small>
        </article>
      </section>

      {showForm && (
        <form className="panel recurring-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>{editingId ? "Editar recorrência" : "Nova recorrência"}</h2>
              <p>
                {editingId
                  ? "As alterações valem para as próximas previsões; lançamentos já gerados são preservados."
                  : "Os próximos 90 dias serão gerados automaticamente no financeiro."}
              </p>
            </div>
            <div className="type-toggle">
              <button
                type="button"
                className={form.type === "expense" ? "selected expense" : ""}
                onClick={() =>
                  setForm({
                    ...form,
                    type: "expense",
                    category_id: "",
                    partner_id: "",
                  })
                }
              >
                Despesa
              </button>
              <button
                type="button"
                className={form.type === "income" ? "selected income" : ""}
                onClick={() =>
                  setForm({
                    ...form,
                    type: "income",
                    category_id: "",
                    partner_id: "",
                  })
                }
              >
                Receita
              </button>
            </div>
          </div>

          <div className="recurring-form-grid">
            <label className="wide">
              Descrição
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder={form.type === "expense" ? "Ex.: Aluguel" : "Ex.: Mensalidade do cliente"}
                required
              />
            </label>
            <label>
              Valor
              <input
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                inputMode="decimal"
                placeholder="0,00"
                required
              />
            </label>
            <label>
              Frequência
              <select
                value={form.frequency}
                onChange={(event) =>
                  setForm({ ...form, frequency: event.target.value as Frequency })
                }
              >
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </label>
            <label>
              A cada
              <div className="interval-input">
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={form.interval_count}
                  onChange={(event) =>
                    setForm({ ...form, interval_count: event.target.value })
                  }
                />
                <span>
                  {form.frequency === "weekly"
                    ? "semana(s)"
                    : form.frequency === "monthly"
                      ? "mês(es)"
                      : "ano(s)"}
                </span>
              </div>
            </label>
            <label>
              Início
              <input
                type="date"
                value={form.start_date}
                onChange={(event) => setForm({ ...form, start_date: event.target.value })}
                required
              />
            </label>
            <label>
              Término
              <input
                type="date"
                min={form.start_date}
                value={form.end_date}
                onChange={(event) => setForm({ ...form, end_date: event.target.value })}
              />
            </label>
            <label>
              Conta / caixa
              <select
                value={form.account_id}
                onChange={(event) => setForm({ ...form, account_id: event.target.value })}
              >
                <option value="">Definir na baixa</option>
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
            <label>
              {form.type === "income" ? "Cliente" : "Fornecedor"}
              <select
                value={form.partner_id}
                onChange={(event) => setForm({ ...form, partner_id: event.target.value })}
              >
                <option value="">Sem vínculo</option>
                {visiblePartners.map((partner) => (
                  <option key={partner.id} value={partner.id}>{partner.name}</option>
                ))}
              </select>
            </label>
          </div>

          {error && <div className="form-alert error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="ghost" onClick={resetForm}>
              Cancelar
            </button>
            <button className="primary" disabled={saving}>
              {saving
                ? "Salvando..."
                : editingId
                  ? "Salvar alterações"
                  : "Salvar recorrência"}
            </button>
          </div>
        </form>
      )}

      {!showForm && error && <div className="form-alert error page-alert">{error}</div>}

      <section className="panel table-panel">
        {loading ? (
          <div className="empty-state">Carregando recorrências...</div>
        ) : rules.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma recorrência cadastrada.</strong>
            <span>Aluguel, assinaturas e mensalidades podem nascer automaticamente aqui.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="recurring-table">
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th>Frequência</th>
                  <th>Próximo lançamento</th>
                  <th>Classificação</th>
                  <th className="right">Valor</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <strong>{rule.description}</strong>
                      {rule.partner_id && (
                        <small className="cell-subtitle">
                          {partnerNames.get(rule.partner_id) ?? "Parceiro removido"}
                        </small>
                      )}
                    </td>
                    <td>
                      <span className={"pill " + rule.type}>
                        {rule.type === "income" ? "Receita" : "Despesa"}
                      </span>
                    </td>
                    <td>
                      {frequencyLabels[rule.frequency]}
                      {rule.interval_count > 1 && (
                        <small className="cell-subtitle">
                          a cada {rule.interval_count}
                        </small>
                      )}
                    </td>
                    <td>
                      {new Date(rule.next_due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                      {rule.end_date && (
                        <small className="cell-subtitle">
                          até {new Date(rule.end_date + "T12:00:00").toLocaleDateString("pt-BR")}
                        </small>
                      )}
                    </td>
                    <td>
                      {rule.category_id ? categoryNames.get(rule.category_id) ?? "—" : "—"}
                      {rule.cost_center_id && (
                        <small className="cell-subtitle">
                          {costCenterNames.get(rule.cost_center_id) ?? "Centro removido"}
                        </small>
                      )}
                    </td>
                    <td className={"right amount " + rule.type}>
                      {money.format(Number(rule.amount))}
                    </td>
                    <td>
                      <span className={rule.active ? "status-badge active" : "status-badge"}>
                        {rule.active ? "Ativa" : "Pausada"}
                      </span>
                    </td>
                    <td className="right">
                      <div className="record-actions right">
                        <button className="table-action edit" onClick={() => editRule(rule)}>
                          Editar
                        </button>
                        <button className="table-action" onClick={() => void toggleRule(rule)}>
                          {rule.active ? "Pausar" : "Reativar"}
                        </button>
                        <button
                          className="table-action danger"
                          onClick={() => requestDeleteRule(rule)}
                          disabled={deletingId === rule.id}
                        >
                          {deletingId === rule.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Excluir recorrência?"
        description={pendingDelete ? `Você está prestes a excluir “${pendingDelete.description}”.` : ""}
        warning="Os lançamentos já gerados serão preservados. Apenas as próximas gerações automáticas deixarão de existir."
        confirmLabel="Excluir recorrência"
        busy={Boolean(deletingId)}
        onCancel={() => { if (!deletingId) setPendingDelete(null); }}
        onConfirm={() => void confirmDeleteRule()}
      />
    </>
  );
}
