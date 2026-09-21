
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import { getDeleteErrorMessage } from "../lib/deleteErrors";

type ProposalStatus = "draft" | "sent" | "approved" | "rejected" | "expired";

type Customer = {
  id: string;
  name: string;
  active: boolean;
  kind: "customer" | "supplier" | "both";
};

type Proposal = {
  id: string;
  customer_id: string;
  proposal_number: number;
  title: string;
  status: ProposalStatus;
  issue_date: string;
  valid_until: string | null;
  notes: string | null;
  subtotal: number | string;
  discount: number | string;
  total: number | string;
  converted_transaction_id: string | null;
};

type ProposalItemForm = {
  description: string;
  quantity: string;
  unit_price: string;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const statusLabels: Record<ProposalStatus, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  approved: "Aprovada",
  rejected: "Rejeitada",
  expired: "Expirada",
};

function parseMoney(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return 0;
  if (clean.includes(",")) return Number(clean.replace(/\./g, "").replace(",", "."));
  return Number(clean);
}

function parseQuantity(value: string) {
  const clean = value.trim().replace(",", ".");
  return Number(clean);
}

function formatProposalNumber(value: number) {
  return "#" + String(value).padStart(4, "0");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ProposalsPage() {
  const { activeCompany } = useCompany();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | ProposalStatus>("all");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [receivableDates, setReceivableDates] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    customer_id: "",
    title: "",
    issue_date: todayIso(),
    valid_until: addDaysIso(15),
    discount: "0,00",
    notes: "",
  });
  const [items, setItems] = useState<ProposalItemForm[]>([
    { description: "", quantity: "1", unit_price: "" },
  ]);

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);
    setError("");

    const [proposalResult, customerResult] = await Promise.all([
      supabase
        .from("proposals")
        .select(
          "id, customer_id, proposal_number, title, status, issue_date, valid_until, notes, subtotal, discount, total, converted_transaction_id",
        )
        .eq("company_id", activeCompany.id)
        .order("proposal_number", { ascending: false }),
      supabase
        .from("business_partners")
        .select("id, name, active, kind")
        .eq("company_id", activeCompany.id)
        .order("name"),
    ]);

    if (proposalResult.error || customerResult.error) {
      setError(
        proposalResult.error?.message ||
          customerResult.error?.message ||
          "Erro ao carregar propostas.",
      );
    } else {
      setProposals((proposalResult.data ?? []) as Proposal[]);
      const loadedCustomers = (customerResult.data ?? []) as Customer[];
      setCustomers(loadedCustomers);
      setForm((current) => ({
        ...current,
        customer_id:
          current.customer_id ||
          loadedCustomers.find(
            (customer) =>
              customer.active && (customer.kind === "customer" || customer.kind === "both"),
          )?.id ||
          "",
      }));
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  const customerNames = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  );

  const activeCustomers = customers.filter(
    (customer) =>
      customer.active && (customer.kind === "customer" || customer.kind === "both"),
  );

  const calculatedSubtotal = useMemo(
    () =>
      items.reduce((sum, item) => {
        const quantity = parseQuantity(item.quantity);
        const price = parseMoney(item.unit_price);
        if (!Number.isFinite(quantity) || !Number.isFinite(price)) return sum;
        return sum + quantity * price;
      }, 0),
    [items],
  );

  const calculatedDiscount = parseMoney(form.discount);
  const calculatedTotal = Math.max(
    0,
    calculatedSubtotal - (Number.isFinite(calculatedDiscount) ? calculatedDiscount : 0),
  );

  const summary = useMemo(() => {
    const currentMonth = todayIso().slice(0, 7);
    return {
      total: proposals.length,
      open: proposals.filter((proposal) => ["draft", "sent"].includes(proposal.status)).length,
      approvedValue: proposals
        .filter((proposal) => proposal.status === "approved")
        .reduce((sum, proposal) => sum + Number(proposal.total), 0),
      monthValue: proposals
        .filter((proposal) => proposal.issue_date.slice(0, 7) === currentMonth)
        .reduce((sum, proposal) => sum + Number(proposal.total), 0),
    };
  }, [proposals]);

  const visibleProposals = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");

    return proposals.filter((proposal) => {
      const actualStatus: ProposalStatus =
        proposal.status !== "approved" &&
        proposal.status !== "rejected" &&
        proposal.valid_until &&
        proposal.valid_until < todayIso()
          ? "expired"
          : proposal.status;

      if (filter !== "all" && actualStatus !== filter) return false;

      if (!normalized) return true;

      const customerName = customerNames.get(proposal.customer_id) ?? "";
      return (
        proposal.title.toLocaleLowerCase("pt-BR").includes(normalized) ||
        customerName.toLocaleLowerCase("pt-BR").includes(normalized) ||
        String(proposal.proposal_number).includes(normalized)
      );
    });
  }, [proposals, filter, query, customerNames]);

  function updateItem(index: number, field: keyof ProposalItemForm, value: string) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  }

  function addItem() {
    setItems((current) => [
      ...current,
      { description: "", quantity: "1", unit_price: "" },
    ]);
  }

  function removeItem(index: number) {
    setItems((current) => {
      if (current.length === 1) {
        return [{ description: "", quantity: "1", unit_price: "" }];
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    if (!form.customer_id) {
      setError("Selecione um cliente.");
      return;
    }

    const normalizedItems = items.map((item) => ({
      description: item.description.trim(),
      quantity: parseQuantity(item.quantity),
      unit_price: parseMoney(item.unit_price),
    }));

    if (
      normalizedItems.some(
        (item) =>
          item.description.length < 2 ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0 ||
          !Number.isFinite(item.unit_price) ||
          item.unit_price < 0,
      )
    ) {
      setError("Confira a descrição, quantidade e valor de todos os itens.");
      return;
    }

    const discount = parseMoney(form.discount);
    if (!Number.isFinite(discount) || discount < 0 || discount > calculatedSubtotal) {
      setError("O desconto deve estar entre zero e o subtotal da proposta.");
      return;
    }

    setSaving(true);
    setError("");

    const { data: proposalData, error: proposalError } = await supabase
      .from("proposals")
      .insert({
        company_id: activeCompany.id,
        customer_id: form.customer_id,
        proposal_number: null,
        title: form.title.trim(),
        issue_date: form.issue_date,
        valid_until: form.valid_until || null,
        notes: form.notes.trim() || null,
        discount: 0,
        subtotal: 0,
        total: 0,
      })
      .select("id")
      .single();

    if (proposalError || !proposalData) {
      setError(proposalError?.message || "Não foi possível criar a proposta.");
      setSaving(false);
      return;
    }

    const proposalId = proposalData.id as string;

    const { error: itemsError } = await supabase.from("proposal_items").insert(
      normalizedItems.map((item, index) => ({
        company_id: activeCompany.id,
        proposal_id: proposalId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        sort_order: index,
      })),
    );

    if (itemsError) {
      await supabase.from("proposals").delete().eq("id", proposalId);
      setError(itemsError.message);
      setSaving(false);
      return;
    }

    if (discount > 0) {
      const { error: discountError } = await supabase
        .from("proposals")
        .update({
          discount,
          total: calculatedSubtotal - discount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", proposalId);

      if (discountError) {
        setError(discountError.message);
        setSaving(false);
        return;
      }
    }

    setForm({
      customer_id: activeCustomers[0]?.id ?? "",
      title: "",
      issue_date: todayIso(),
      valid_until: addDaysIso(15),
      discount: "0,00",
      notes: "",
    });
    setItems([{ description: "", quantity: "1", unit_price: "" }]);
    setShowForm(false);
    setSaving(false);
    await load();
  }

  async function setStatus(proposal: Proposal, status: ProposalStatus) {
    if (!supabase) return;
    setError("");

    const { error: updateError } = await supabase
      .from("proposals")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposal.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await load();
  }

  async function deleteProposal(proposal: Proposal) {
    if (!supabase || !activeCompany || deletingId) return;

    const confirmed = window.confirm(
      `Excluir a proposta "${proposal.title}"?\n\nOs itens da proposta serão removidos junto. Uma conta a receber já gerada, se existir, será preservada.`,
    );
    if (!confirmed) return;

    setDeletingId(proposal.id);
    setError("");

    const { error: deleteError } = await supabase
      .from("proposals")
      .delete()
      .eq("id", proposal.id)
      .eq("company_id", activeCompany.id);

    if (deleteError) {
      setError(getDeleteErrorMessage(deleteError, "esta proposta"));
      setDeletingId(null);
      return;
    }

    setDeletingId(null);
    await load();
  }

  async function convertToReceivable(proposal: Proposal) {
    if (!supabase) return;
    const dueDate = receivableDates[proposal.id] || todayIso();
    setError("");

    const { error: rpcError } = await supabase.rpc("convert_proposal_to_receivable", {
      p_proposal_id: proposal.id,
      p_due_date: dueDate,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    await load();
  }

  return (
    <>
      <header className="page-header split">
        <div>
          <p className="eyebrow">COMERCIAL</p>
          <h1>Propostas</h1>
          <p>Monte orçamentos, acompanhe aprovações e transforme vendas em contas a receber.</p>
        </div>
        <button className="primary" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Nova proposta"}
        </button>
      </header>

      <section className="metrics proposal-metrics">
        <article className="metric-card">
          <span>Total de propostas</span>
          <strong>{summary.total}</strong>
          <small>{summary.open} em aberto</small>
        </article>
        <article className="metric-card">
          <span>Aprovadas</span>
          <strong>{money.format(summary.approvedValue)}</strong>
          <small>Valor aprovado</small>
        </article>
        <article className="metric-card">
          <span>Emitidas no mês</span>
          <strong>{money.format(summary.monthValue)}</strong>
          <small>Volume comercial</small>
        </article>
        <article className="metric-card">
          <span>Conversão financeira</span>
          <strong>
            {proposals.filter((proposal) => proposal.converted_transaction_id).length}
          </strong>
          <small>Conta(s) a receber gerada(s)</small>
        </article>
      </section>

      {showForm && (
        <form className="panel proposal-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>Nova proposta</h2>
              <p>Monte os itens e o Valora calcula o total automaticamente.</p>
            </div>
          </div>

          <div className="proposal-main-grid">
            <label className="wide">
              Título
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Ex.: Projeto de consultoria"
                required
              />
            </label>
            <label>
              Cliente
              <select
                value={form.customer_id}
                onChange={(event) => setForm({ ...form, customer_id: event.target.value })}
                required
              >
                <option value="" disabled>Selecione</option>
                {activeCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </label>
            <label>
              Emissão
              <input
                type="date"
                value={form.issue_date}
                onChange={(event) => setForm({ ...form, issue_date: event.target.value })}
                required
              />
            </label>
            <label>
              Válida até
              <input
                type="date"
                min={form.issue_date}
                value={form.valid_until}
                onChange={(event) => setForm({ ...form, valid_until: event.target.value })}
              />
            </label>
          </div>

          <div className="proposal-items">
            <div className="proposal-items-heading">
              <div>
                <strong>Itens da proposta</strong>
                <span>Quantidade × valor unitário</span>
              </div>
              <button type="button" className="ghost compact-button" onClick={addItem}>
                + Adicionar item
              </button>
            </div>

            {items.map((item, index) => {
              const quantity = parseQuantity(item.quantity);
              const unitPrice = parseMoney(item.unit_price);
              const lineTotal =
                Number.isFinite(quantity) && Number.isFinite(unitPrice)
                  ? quantity * unitPrice
                  : 0;

              return (
                <div className="proposal-item-row" key={index}>
                  <label className="item-description">
                    Descrição
                    <input
                      value={item.description}
                      onChange={(event) => updateItem(index, "description", event.target.value)}
                      placeholder="Produto ou serviço"
                      required
                    />
                  </label>
                  <label>
                    Quantidade
                    <input
                      value={item.quantity}
                      onChange={(event) => updateItem(index, "quantity", event.target.value)}
                      inputMode="decimal"
                      required
                    />
                  </label>
                  <label>
                    Valor unitário
                    <input
                      value={item.unit_price}
                      onChange={(event) => updateItem(index, "unit_price", event.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      required
                    />
                  </label>
                  <div className="proposal-line-total">
                    <span>Total</span>
                    <strong>{money.format(lineTotal)}</strong>
                  </div>
                  <button
                    type="button"
                    className="remove-item"
                    onClick={() => removeItem(index)}
                    title="Remover item"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <div className="proposal-bottom-grid">
            <label>
              Desconto
              <input
                value={form.discount}
                onChange={(event) => setForm({ ...form, discount: event.target.value })}
                inputMode="decimal"
                placeholder="0,00"
              />
            </label>
            <label className="wide">
              Observações
              <input
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Condições, escopo ou informações adicionais"
              />
            </label>
            <div className="proposal-total-box">
              <span>Subtotal {money.format(calculatedSubtotal)}</span>
              <span>Desconto {money.format(Number.isFinite(calculatedDiscount) ? calculatedDiscount : 0)}</span>
              <strong>Total {money.format(calculatedTotal)}</strong>
            </div>
          </div>

          {activeCustomers.length === 0 && (
            <div className="form-alert error">
              Cadastre ao menos um cliente ativo antes de criar uma proposta.
            </div>
          )}
          {error && <div className="form-alert error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
            <button className="primary" disabled={saving || activeCustomers.length === 0}>
              {saving ? "Salvando..." : "Salvar proposta"}
            </button>
          </div>
        </form>
      )}

      {!showForm && error && <div className="form-alert error page-alert">{error}</div>}

      <section className="panel table-panel">
        <div className="table-toolbar proposal-toolbar">
          <input
            className="table-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar proposta ou cliente..."
          />
          <div className="filter-tabs">
            {(["all", "draft", "sent", "approved", "rejected", "expired"] as const).map(
              (value) => (
                <button
                  key={value}
                  className={filter === value ? "filter-tab active" : "filter-tab"}
                  onClick={() => setFilter(value)}
                >
                  {value === "all" ? "Todas" : statusLabels[value]}
                </button>
              ),
            )}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Carregando propostas...</div>
        ) : visibleProposals.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma proposta nesta visão.</strong>
            <span>Crie uma proposta para iniciar seu fluxo comercial.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="proposals-table">
              <thead>
                <tr>
                  <th>Proposta</th>
                  <th>Cliente</th>
                  <th>Validade</th>
                  <th>Status</th>
                  <th className="right">Total</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleProposals.map((proposal) => {
                  const actualStatus: ProposalStatus =
                    proposal.status !== "approved" &&
                    proposal.status !== "rejected" &&
                    proposal.valid_until &&
                    proposal.valid_until < todayIso()
                      ? "expired"
                      : proposal.status;

                  return (
                    <tr key={proposal.id}>
                      <td>
                        <strong>{formatProposalNumber(proposal.proposal_number)} · {proposal.title}</strong>
                        <small className="cell-subtitle">
                          Emitida em {new Date(proposal.issue_date + "T12:00:00").toLocaleDateString("pt-BR")}
                        </small>
                      </td>
                      <td>{customerNames.get(proposal.customer_id) ?? "Cliente removido"}</td>
                      <td>
                        {proposal.valid_until
                          ? new Date(proposal.valid_until + "T12:00:00").toLocaleDateString("pt-BR")
                          : "Sem prazo"}
                      </td>
                      <td>
                        <span className={"proposal-status " + actualStatus}>
                          {statusLabels[actualStatus]}
                        </span>
                      </td>
                      <td className="right"><strong>{money.format(Number(proposal.total))}</strong></td>
                      <td>
                        <div className="proposal-actions">
                          {proposal.status === "draft" && actualStatus !== "expired" && (
                            <button className="table-action" onClick={() => void setStatus(proposal, "sent")}>
                              Marcar enviada
                            </button>
                          )}

                          {proposal.status === "sent" && actualStatus !== "expired" && (
                            <>
                              <button className="table-action" onClick={() => void setStatus(proposal, "approved")}>
                                Aprovar
                              </button>
                              <button className="table-action muted-action" onClick={() => void setStatus(proposal, "rejected")}>
                                Rejeitar
                              </button>
                            </>
                          )}

                          {proposal.status === "approved" && !proposal.converted_transaction_id && (
                            <div className="proposal-convert">
                              <input
                                type="date"
                                value={receivableDates[proposal.id] || todayIso()}
                                onChange={(event) =>
                                  setReceivableDates((current) => ({
                                    ...current,
                                    [proposal.id]: event.target.value,
                                  }))
                                }
                              />
                              <button className="table-action" onClick={() => void convertToReceivable(proposal)}>
                                Gerar conta a receber
                              </button>
                            </div>
                          )}

                          {proposal.converted_transaction_id && (
                            <span className="converted-badge">Conta a receber gerada</span>
                          )}

                          {actualStatus === "expired" && proposal.status !== "expired" && (
                            <button className="table-action muted-action" onClick={() => void setStatus(proposal, "expired")}>
                              Arquivar expirada
                            </button>
                          )}

                          <button
                            className="table-action danger"
                            onClick={() => void deleteProposal(proposal)}
                            disabled={deletingId === proposal.id}
                          >
                            {deletingId === proposal.id ? "Excluindo..." : "Excluir"}
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
    </>
  );
}
