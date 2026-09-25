
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import { getDeleteErrorMessage } from "../lib/deleteErrors";

type PartnerKind = "customer" | "supplier" | "both";
type ViewKind = "customer" | "supplier";

type Partner = {
  id: string;
  kind: PartnerKind;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  notes: string | null;
  active: boolean;
};

type Transaction = {
  id: string;
  partner_id: string | null;
  amount: number | string;
  status: "pending" | "paid" | "cancelled";
  type: "income" | "expense";
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function partnerMatchesView(kind: PartnerKind, view: ViewKind) {
  return kind === view || kind === "both";
}

export function BusinessPartnersPage({ view }: { view: ViewKind }) {
  const { activeCompany } = useCompany();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    kind: view as PartnerKind,
    document: "",
    email: "",
    phone: "",
    city: "",
    notes: "",
  });

  const isCustomer = view === "customer";
  const title = isCustomer ? "Clientes" : "Fornecedores";
  const singular = isCustomer ? "cliente" : "fornecedor";
  const transactionType = isCustomer ? "income" : "expense";

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);
    setError("");

    const [partnerResult, txResult] = await Promise.all([
      supabase
        .from("business_partners")
        .select("id, kind, name, document, email, phone, city, notes, active")
        .eq("company_id", activeCompany.id)
        .order("active", { ascending: false })
        .order("name"),
      supabase
        .from("transactions")
        .select("id, partner_id, amount, status, type")
        .eq("company_id", activeCompany.id)
        .eq("type", transactionType)
        .neq("status", "cancelled"),
    ]);

    if (partnerResult.error || txResult.error) {
      setError(
        partnerResult.error?.message ||
          txResult.error?.message ||
          "Erro ao carregar dados.",
      );
    } else {
      setPartners((partnerResult.data ?? []) as Partner[]);
      setTransactions((txResult.data ?? []) as Transaction[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    setForm((current) => ({ ...current, kind: view }));
    void load();
  }, [activeCompany?.id, view]);

  const metrics = useMemo(() => {
    const visible = partners.filter((partner) => partnerMatchesView(partner.kind, view));
    const visibleIds = new Set(visible.map((partner) => partner.id));

    let pending = 0;
    let realized = 0;

    for (const item of transactions) {
      if (!item.partner_id || !visibleIds.has(item.partner_id)) continue;
      if (item.status === "paid") realized += Number(item.amount);
      if (item.status === "pending") pending += Number(item.amount);
    }

    return {
      total: visible.length,
      active: visible.filter((partner) => partner.active).length,
      pending,
      realized,
    };
  }, [partners, transactions, view]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");

    return partners
      .filter((partner) => partnerMatchesView(partner.kind, view))
      .filter((partner) => {
        if (!normalized) return true;
        return [
          partner.name,
          partner.document ?? "",
          partner.email ?? "",
          partner.phone ?? "",
          partner.city ?? "",
        ].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalized));
      });
  }, [partners, query, view]);

  const totalsByPartner = useMemo(() => {
    const map = new Map<string, { pending: number; realized: number }>();

    for (const item of transactions) {
      if (!item.partner_id) continue;
      const current = map.get(item.partner_id) ?? { pending: 0, realized: 0 };
      if (item.status === "pending") current.pending += Number(item.amount);
      if (item.status === "paid") current.realized += Number(item.amount);
      map.set(item.partner_id, current);
    }

    return map;
  }, [transactions]);

  function resetForm() {
    setForm({
      name: "",
      kind: view,
      document: "",
      email: "",
      phone: "",
      city: "",
      notes: "",
    });
    setEditingId(null);
    setShowForm(false);
    setError("");
  }

  function openNewPartner() {
    setEditingId(null);
    setForm({
      name: "",
      kind: view,
      document: "",
      email: "",
      phone: "",
      city: "",
      notes: "",
    });
    setError("");
    setShowForm(true);
  }

  function editPartner(partner: Partner) {
    setEditingId(partner.id);
    setForm({
      name: partner.name,
      kind: partner.kind,
      document: partner.document ?? "",
      email: partner.email ?? "",
      phone: partner.phone ?? "",
      city: partner.city ?? "",
      notes: partner.notes ?? "",
    });
    setError("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    setSaving(true);
    setError("");

    const payload = {
      kind: form.kind,
      name: form.name.trim(),
      document: form.document.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      city: form.city.trim() || null,
      notes: form.notes.trim() || null,
    };

    const mutation = editingId
      ? supabase
          .from("business_partners")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editingId)
          .eq("company_id", activeCompany.id)
      : supabase.from("business_partners").insert({
          company_id: activeCompany.id,
          ...payload,
        });

    const { error: mutationError } = await mutation;

    if (mutationError) {
      setError(
        editingId
          ? `Não foi possível atualizar este ${singular}.`
          : mutationError.message,
      );
      setSaving(false);
      return;
    }

    setSaving(false);
    resetForm();
    await load();
  }

  function requestDeletePartner(partner: Partner) {
    if (deletingId) return;
    setPendingDelete(partner);
  }

  async function confirmDeletePartner() {
    if (!supabase || !activeCompany || !pendingDelete || deletingId) return;
    const partner = pendingDelete;
    setDeletingId(partner.id);
    setError("");

    const { error: deleteError } = await supabase
      .from("business_partners")
      .delete()
      .eq("id", partner.id)
      .eq("company_id", activeCompany.id);

    if (deleteError) {
      setError(
        getDeleteErrorMessage(
          deleteError,
          `este ${isCustomer ? "cliente" : "fornecedor"}`,
          `Não é possível excluir este ${isCustomer ? "cliente" : "fornecedor"} porque há propostas vinculadas. Você pode desativá-lo para manter o histórico.`,
        ),
      );
      setDeletingId(null);
      setPendingDelete(null);
      return;
    }

    setDeletingId(null);
    setPendingDelete(null);
    await load();
  }

  async function toggleActive(partner: Partner) {
    if (!supabase) return;

    const { error: updateError } = await supabase
      .from("business_partners")
      .update({
        active: !partner.active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", partner.id);

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
          <p className="eyebrow">RELACIONAMENTOS</p>
          <h1>{title}</h1>
          <p>
            {isCustomer
              ? "Cadastre clientes e acompanhe valores a receber por relacionamento."
              : "Cadastre fornecedores e acompanhe compromissos financeiros por relacionamento."}
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            if (showForm) resetForm();
            else openNewPartner();
          }}
        >
          {showForm ? "Fechar" : "+ Novo " + singular}
        </button>
      </header>

      <section className="compact-metrics partner-metrics">
        <article className="metric-card">
          <span>Total cadastrado</span>
          <strong>{metrics.total}</strong>
          <small>{metrics.active} ativo(s)</small>
        </article>
        <article className="metric-card">
          <span>{isCustomer ? "A receber" : "A pagar"}</span>
          <strong>{money.format(metrics.pending)}</strong>
          <small>Lançamentos pendentes vinculados</small>
        </article>
        <article className="metric-card">
          <span>{isCustomer ? "Recebido" : "Pago"}</span>
          <strong>{money.format(metrics.realized)}</strong>
          <small>Histórico realizado</small>
        </article>
      </section>

      {showForm && (
        <form className="panel partner-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>{editingId ? "Editar " + singular : "Novo " + singular}</h2>
              <p>
                {editingId
                  ? "Atualize os dados deste relacionamento."
                  : "Cadastre os dados essenciais agora. Detalhes avançados podem vir depois."}
              </p>
            </div>
          </div>

          <div className="partner-form-grid">
            <label className="wide">
              Nome / Razão social
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Ex.: Empresa Exemplo Ltda."
                required
              />
            </label>

            <label>
              Relação
              <select
                value={form.kind}
                onChange={(event) =>
                  setForm({ ...form, kind: event.target.value as PartnerKind })
                }
              >
                <option value={view}>{isCustomer ? "Cliente" : "Fornecedor"}</option>
                <option value="both">Cliente e fornecedor</option>
              </select>
            </label>

            <label>
              CPF / CNPJ
              <input
                value={form.document}
                onChange={(event) => setForm({ ...form, document: event.target.value })}
                placeholder="Opcional"
              />
            </label>

            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="contato@empresa.com"
              />
            </label>

            <label>
              Telefone
              <input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="(00) 00000-0000"
              />
            </label>

            <label>
              Cidade
              <input
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
                placeholder="Opcional"
              />
            </label>

            <label className="wide">
              Observações
              <input
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Informações úteis sobre este relacionamento"
              />
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
                  : "Salvar " + singular}
            </button>
          </div>
        </form>
      )}

      {!showForm && error && <div className="form-alert error page-alert">{error}</div>}

      <section className="panel table-panel">
        <div className="table-toolbar partner-toolbar">
          <input
            className="table-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={"Buscar " + title.toLocaleLowerCase("pt-BR") + "..."}
          />
          <span>{filtered.length} resultado(s)</span>
        </div>

        {loading ? (
          <div className="empty-state">Carregando {title.toLocaleLowerCase("pt-BR")}...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhum {singular} encontrado.</strong>
            <span>Cadastre o primeiro relacionamento para começar.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="partners-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Contato</th>
                  <th>Documento</th>
                  <th>{isCustomer ? "A receber" : "A pagar"}</th>
                  <th>{isCustomer ? "Recebido" : "Pago"}</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((partner) => {
                  const totals = totalsByPartner.get(partner.id) ?? {
                    pending: 0,
                    realized: 0,
                  };

                  return (
                    <tr key={partner.id}>
                      <td>
                        <strong>{partner.name}</strong>
                        {partner.city && <small className="cell-subtitle">{partner.city}</small>}
                      </td>
                      <td>
                        {partner.email || partner.phone || "—"}
                        {partner.email && partner.phone && (
                          <small className="cell-subtitle">{partner.phone}</small>
                        )}
                      </td>
                      <td>{partner.document || "—"}</td>
                      <td>{money.format(totals.pending)}</td>
                      <td>{money.format(totals.realized)}</td>
                      <td>
                        <span className={partner.active ? "status-badge active" : "status-badge"}>
                          {partner.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="right">
                        <div className="record-actions right">
                          <button className="table-action edit" onClick={() => editPartner(partner)}>
                            Editar
                          </button>
                          <button className="table-action" onClick={() => void toggleActive(partner)}>
                            {partner.active ? "Desativar" : "Reativar"}
                          </button>
                          <button
                            className="table-action danger"
                            onClick={() => requestDeletePartner(partner)}
                            disabled={deletingId === partner.id}
                          >
                            {deletingId === partner.id ? "Excluindo..." : "Excluir"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={isCustomer ? "Excluir cliente?" : "Excluir fornecedor?"}
        description={pendingDelete ? `Você está prestes a excluir “${pendingDelete.name}”.` : ""}
        warning="Lançamentos vinculados serão mantidos sem este cadastro. Se houver proposta vinculada, a exclusão será bloqueada."
        confirmLabel={isCustomer ? "Excluir cliente" : "Excluir fornecedor"}
        busy={Boolean(deletingId)}
        onCancel={() => { if (!deletingId) setPendingDelete(null); }}
        onConfirm={() => void confirmDeletePartner()}
      />
    </>
  );
}
