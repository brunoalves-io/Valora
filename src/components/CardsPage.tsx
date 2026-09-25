
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import { getDeleteErrorMessage } from "../lib/deleteErrors";

type Card = {
  id: string;
  name: string;
  brand: string | null;
  last_four: string | null;
  credit_limit: number | string;
  closing_day: number;
  due_day: number;
  default_payment_account_id: string | null;
  active: boolean;
};

type CardTransaction = {
  id: string;
  description: string;
  amount: number | string;
  due_date: string;
  status: "pending" | "paid" | "cancelled";
  credit_card_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
};

type Named = { id: string; name: string };
type Partner = { id: string; name: string; kind: "customer" | "supplier" | "both"; active: boolean };
type Category = { id: string; name: string; type: "income" | "expense" | "both"; active?: boolean };

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function parseMoney(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return 0;
  if (clean.includes(",")) return Number(clean.replace(/\./g, "").replace(",", "."));
  return Number(clean);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function CardsPage() {
  const { activeCompany } = useCompany();
  const [cards, setCards] = useState<Card[]>([]);
  const [transactions, setTransactions] = useState<CardTransaction[]>([]);
  const [accounts, setAccounts] = useState<Named[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<Named[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [showCardForm, setShowCardForm] = useState(false);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const [statementAccounts, setStatementAccounts] = useState<Record<string, string>>({});
  const [cardForm, setCardForm] = useState({
    name: "",
    brand: "",
    last_four: "",
    credit_limit: "",
    closing_day: "25",
    due_day: "5",
    default_payment_account_id: "",
  });
  const [purchaseForm, setPurchaseForm] = useState({
    card_id: "",
    description: "",
    total_amount: "",
    purchase_date: todayIso(),
    installments: "1",
    category_id: "",
    cost_center_id: "",
    partner_id: "",
  });

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);
    setError("");

    const [cardResult, txResult, accountResult, categoryResult, costCenterResult, partnerResult] =
      await Promise.all([
        supabase
          .from("credit_cards")
          .select("id, name, brand, last_four, credit_limit, closing_day, due_day, default_payment_account_id, active")
          .eq("company_id", activeCompany.id)
          .order("active", { ascending: false })
          .order("name"),
        supabase
          .from("transactions")
          .select("id, description, amount, due_date, status, credit_card_id, installment_number, installment_total")
          .eq("company_id", activeCompany.id)
          .not("credit_card_id", "is", null)
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
          .select("id, name, type, active")
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
      cardResult.error ||
      txResult.error ||
      accountResult.error ||
      categoryResult.error ||
      costCenterResult.error ||
      partnerResult.error;

    if (firstError) {
      setError(firstError.message);
    } else {
      const loadedCards = (cardResult.data ?? []) as Card[];
      const loadedAccounts = (accountResult.data ?? []) as Named[];
      setCards(loadedCards);
      setTransactions((txResult.data ?? []) as CardTransaction[]);
      setAccounts(loadedAccounts);
      setCategories((categoryResult.data ?? []) as Category[]);
      setCostCenters((costCenterResult.data ?? []) as Named[]);
      setPartners((partnerResult.data ?? []) as Partner[]);

      setPurchaseForm((current) => ({
        ...current,
        card_id: current.card_id || loadedCards.find((card) => card.active)?.id || "",
      }));
      setCardForm((current) => ({
        ...current,
        default_payment_account_id:
          current.default_payment_account_id || loadedAccounts[0]?.id || "",
      }));
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  const activeCards = cards.filter((card) => card.active);
  const expenseCategories = categories.filter(
    (category) => category.type === "expense" || category.type === "both",
  );
  const suppliers = partners.filter(
    (partner) =>
      partner.active && (partner.kind === "supplier" || partner.kind === "both"),
  );

  const openByCard = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of transactions) {
      if (!item.credit_card_id || item.status !== "pending") continue;
      map.set(
        item.credit_card_id,
        (map.get(item.credit_card_id) ?? 0) + Number(item.amount),
      );
    }
    return map;
  }, [transactions]);

  const statements = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        cardId: string;
        dueDate: string;
        total: number;
        items: CardTransaction[];
      }
    >();

    for (const item of transactions) {
      if (!item.credit_card_id || item.status !== "pending") continue;
      const key = item.credit_card_id + "|" + item.due_date;
      const current = map.get(key) ?? {
        key,
        cardId: item.credit_card_id,
        dueDate: item.due_date,
        total: 0,
        items: [],
      };
      current.total += Number(item.amount);
      current.items.push(item);
      map.set(key, current);
    }

    return Array.from(map.values()).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [transactions]);

  const cardNames = useMemo(
    () => new Map(cards.map((card) => [card.id, card.name])),
    [cards],
  );

  const cardMap = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  );

  function resetCardForm() {
    setCardForm({
      name: "",
      brand: "",
      last_four: "",
      credit_limit: "",
      closing_day: "25",
      due_day: "5",
      default_payment_account_id: accounts[0]?.id ?? "",
    });
    setEditingCardId(null);
    setShowCardForm(false);
    setError("");
  }

  function openNewCard() {
    setEditingCardId(null);
    setCardForm({
      name: "",
      brand: "",
      last_four: "",
      credit_limit: "",
      closing_day: "25",
      due_day: "5",
      default_payment_account_id: accounts[0]?.id ?? "",
    });
    setError("");
    setShowCardForm(true);
  }

  function editCard(card: Card) {
    setEditingCardId(card.id);
    setCardForm({
      name: card.name,
      brand: card.brand ?? "",
      last_four: card.last_four ?? "",
      credit_limit: String(card.credit_limit).replace(".", ","),
      closing_day: String(card.closing_day),
      due_day: String(card.due_day),
      default_payment_account_id: card.default_payment_account_id ?? "",
    });
    setShowPurchaseForm(false);
    setError("");
    setShowCardForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function createCard(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    const limit = parseMoney(cardForm.credit_limit);
    const closingDay = Number(cardForm.closing_day);
    const dueDay = Number(cardForm.due_day);

    if (!Number.isFinite(limit) || limit < 0) {
      setError("Informe um limite válido.");
      return;
    }
    if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 28) {
      setError("O fechamento deve estar entre os dias 1 e 28.");
      return;
    }
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
      setError("O vencimento deve estar entre os dias 1 e 28.");
      return;
    }
    if (cardForm.last_four && !/^\d{4}$/.test(cardForm.last_four)) {
      setError("Os últimos dígitos devem conter exatamente 4 números.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      name: cardForm.name.trim(),
      brand: cardForm.brand.trim() || null,
      last_four: cardForm.last_four || null,
      credit_limit: limit,
      closing_day: closingDay,
      due_day: dueDay,
      default_payment_account_id: cardForm.default_payment_account_id || null,
    };

    const mutation = editingCardId
      ? supabase
          .from("credit_cards")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editingCardId)
          .eq("company_id", activeCompany.id)
      : supabase.from("credit_cards").insert({
          company_id: activeCompany.id,
          ...payload,
        });

    const { error: mutationError } = await mutation;

    if (mutationError) {
      setError(
        editingCardId ? "Não foi possível atualizar este cartão." : mutationError.message,
      );
      setSaving(false);
      return;
    }

    setSaving(false);
    resetCardForm();
    await load();
  }

  async function createPurchase(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    const total = parseMoney(purchaseForm.total_amount);
    const installments = Number(purchaseForm.installments);

    if (!purchaseForm.card_id) {
      setError("Selecione um cartão.");
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      setError("Informe um valor de compra válido.");
      return;
    }
    if (!Number.isInteger(installments) || installments < 1 || installments > 120) {
      setError("A quantidade de parcelas deve estar entre 1 e 120.");
      return;
    }

    setSaving(true);
    setError("");

    const { error: rpcError } = await supabase.rpc("create_card_purchase", {
      p_company_id: activeCompany.id,
      p_card_id: purchaseForm.card_id,
      p_description: purchaseForm.description.trim(),
      p_total_amount: total,
      p_purchase_date: purchaseForm.purchase_date,
      p_installments: installments,
      p_category_id: purchaseForm.category_id || null,
      p_cost_center_id: purchaseForm.cost_center_id || null,
      p_partner_id: purchaseForm.partner_id || null,
    });

    if (rpcError) {
      setError(rpcError.message);
      setSaving(false);
      return;
    }

    setPurchaseForm({
      card_id: activeCards[0]?.id ?? "",
      description: "",
      total_amount: "",
      purchase_date: todayIso(),
      installments: "1",
      category_id: "",
      cost_center_id: "",
      partner_id: "",
    });
    setShowPurchaseForm(false);
    setSaving(false);
    await load();
  }

  async function payStatement(cardId: string, dueDate: string) {
    if (!supabase) return;

    const card = cardMap.get(cardId);
    const accountId =
      statementAccounts[cardId + "|" + dueDate] ||
      card?.default_payment_account_id ||
      accounts[0]?.id ||
      "";

    if (!accountId) {
      setError("Selecione uma conta para pagar a fatura.");
      return;
    }

    setError("");

    const { error: rpcError } = await supabase.rpc("pay_card_statement", {
      p_card_id: cardId,
      p_due_date: dueDate,
      p_account_id: accountId,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    await load();
  }

  function requestDeleteCard(card: Card) {
    if (deletingId) return;
    setPendingDelete(card);
  }

  async function confirmDeleteCard() {
    if (!supabase || !activeCompany || !pendingDelete || deletingId) return;
    const card = pendingDelete;
    setDeletingId(card.id);
    setError("");

    const { error: deleteError } = await supabase
      .from("credit_cards")
      .delete()
      .eq("id", card.id)
      .eq("company_id", activeCompany.id);

    if (deleteError) {
      setError(getDeleteErrorMessage(deleteError, "este cartão"));
      setDeletingId(null);
      setPendingDelete(null);
      return;
    }

    setDeletingId(null);
    setPendingDelete(null);
    await load();
  }

  async function toggleCard(card: Card) {
    if (!supabase) return;

    const { error: updateError } = await supabase
      .from("credit_cards")
      .update({ active: !card.active, updated_at: new Date().toISOString() })
      .eq("id", card.id);

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
          <h1>Cartões</h1>
          <p>Controle limites, compras parceladas, faturas e pagamentos.</p>
        </div>
        <div className="header-actions">
          <button
            className="ghost"
            onClick={() => {
              if (showCardForm) resetCardForm();
              else openNewCard();
            }}
          >
            {showCardForm ? "Fechar cadastro" : "+ Novo cartão"}
          </button>
          <button
            className="primary"
            onClick={() => setShowPurchaseForm((value) => !value)}
            disabled={activeCards.length === 0}
          >
            {showPurchaseForm ? "Fechar compra" : "+ Nova compra"}
          </button>
        </div>
      </header>

      {showCardForm && (
        <form className="panel card-form" onSubmit={createCard}>
          <div className="form-heading">
            <div>
              <h2>{editingCardId ? "Editar cartão" : "Novo cartão"}</h2>
              <p>
                {editingCardId
                  ? "Atualize os dados do cartão sem alterar as compras já registradas."
                  : "Cadastre os dados usados para montar as faturas automaticamente."}
              </p>
            </div>
          </div>
          <div className="card-form-grid">
            <label>
              Nome
              <input
                value={cardForm.name}
                onChange={(event) => setCardForm({ ...cardForm, name: event.target.value })}
                placeholder="Ex.: Nubank PJ"
                required
              />
            </label>
            <label>
              Bandeira
              <input
                value={cardForm.brand}
                onChange={(event) => setCardForm({ ...cardForm, brand: event.target.value })}
                placeholder="Ex.: Mastercard"
              />
            </label>
            <label>
              Últimos 4 dígitos
              <input
                value={cardForm.last_four}
                onChange={(event) =>
                  setCardForm({
                    ...cardForm,
                    last_four: event.target.value.replace(/\D/g, "").slice(0, 4),
                  })
                }
                placeholder="1234"
                inputMode="numeric"
              />
            </label>
            <label>
              Limite
              <input
                value={cardForm.credit_limit}
                onChange={(event) => setCardForm({ ...cardForm, credit_limit: event.target.value })}
                placeholder="0,00"
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Dia do fechamento
              <input
                type="number"
                min="1"
                max="28"
                value={cardForm.closing_day}
                onChange={(event) => setCardForm({ ...cardForm, closing_day: event.target.value })}
                required
              />
            </label>
            <label>
              Dia do vencimento
              <input
                type="number"
                min="1"
                max="28"
                value={cardForm.due_day}
                onChange={(event) => setCardForm({ ...cardForm, due_day: event.target.value })}
                required
              />
            </label>
            <label>
              Conta padrão para pagamento
              <select
                value={cardForm.default_payment_account_id}
                onChange={(event) =>
                  setCardForm({
                    ...cardForm,
                    default_payment_account_id: event.target.value,
                  })
                }
              >
                <option value="">Sem conta padrão</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>
          </div>
          {error && <div className="form-alert error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={resetCardForm}>
              Cancelar
            </button>
            <button className="primary" disabled={saving}>
              {saving
                ? "Salvando..."
                : editingCardId
                  ? "Salvar alterações"
                  : "Salvar cartão"}
            </button>
          </div>
        </form>
      )}

      {showPurchaseForm && (
        <form className="panel card-form" onSubmit={createPurchase}>
          <div className="form-heading">
            <div>
              <h2>Nova compra no cartão</h2>
              <p>O Valora distribui as parcelas nas próximas faturas automaticamente.</p>
            </div>
          </div>
          <div className="card-form-grid purchase-grid">
            <label>
              Cartão
              <select
                value={purchaseForm.card_id}
                onChange={(event) =>
                  setPurchaseForm({ ...purchaseForm, card_id: event.target.value })
                }
                required
              >
                <option value="" disabled>Selecione</option>
                {activeCards.map((card) => (
                  <option key={card.id} value={card.id}>{card.name}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Descrição
              <input
                value={purchaseForm.description}
                onChange={(event) =>
                  setPurchaseForm({ ...purchaseForm, description: event.target.value })
                }
                placeholder="Ex.: Notebook para escritório"
                required
              />
            </label>
            <label>
              Valor total
              <input
                value={purchaseForm.total_amount}
                onChange={(event) =>
                  setPurchaseForm({ ...purchaseForm, total_amount: event.target.value })
                }
                placeholder="0,00"
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Data da compra
              <input
                type="date"
                value={purchaseForm.purchase_date}
                onChange={(event) =>
                  setPurchaseForm({ ...purchaseForm, purchase_date: event.target.value })
                }
                required
              />
            </label>
            <label>
              Parcelas
              <input
                type="number"
                min="1"
                max="120"
                value={purchaseForm.installments}
                onChange={(event) =>
                  setPurchaseForm({ ...purchaseForm, installments: event.target.value })
                }
                required
              />
            </label>
            <label>
              Categoria
              <select
                value={purchaseForm.category_id}
                onChange={(event) =>
                  setPurchaseForm({ ...purchaseForm, category_id: event.target.value })
                }
              >
                <option value="">Sem categoria</option>
                {expenseCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              Centro de custo
              <select
                value={purchaseForm.cost_center_id}
                onChange={(event) =>
                  setPurchaseForm({ ...purchaseForm, cost_center_id: event.target.value })
                }
              >
                <option value="">Sem centro de custo</option>
                {costCenters.map((center) => (
                  <option key={center.id} value={center.id}>{center.name}</option>
                ))}
              </select>
            </label>
            <label>
              Fornecedor
              <select
                value={purchaseForm.partner_id}
                onChange={(event) =>
                  setPurchaseForm({ ...purchaseForm, partner_id: event.target.value })
                }
              >
                <option value="">Sem vínculo</option>
                {suppliers.map((partner) => (
                  <option key={partner.id} value={partner.id}>{partner.name}</option>
                ))}
              </select>
            </label>
          </div>
          {error && <div className="form-alert error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => setShowPurchaseForm(false)}>
              Cancelar
            </button>
            <button className="primary" disabled={saving}>
              {saving ? "Gerando..." : "Registrar compra"}
            </button>
          </div>
        </form>
      )}

      {!showCardForm && !showPurchaseForm && error && (
        <div className="form-alert error page-alert">{error}</div>
      )}

      {loading ? (
        <section className="panel empty-state">Carregando cartões...</section>
      ) : (
        <>
          <section className="card-grid">
            {cards.map((card) => {
              const open = openByCard.get(card.id) ?? 0;
              const limit = Number(card.credit_limit);
              const available = Math.max(0, limit - open);
              const utilization = limit > 0 ? Math.min(100, (open / limit) * 100) : 0;

              return (
                <article className={card.active ? "credit-card-card" : "credit-card-card inactive"} key={card.id}>
                  <div className="credit-card-top">
                    <div>
                      <small>{card.brand || "Cartão"}</small>
                      <h2>{card.name}</h2>
                    </div>
                    <span className={card.active ? "status-badge active" : "status-badge"}>
                      {card.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <div className="credit-card-number">
                    •••• {card.last_four || "••••"}
                  </div>
                  <div className="credit-card-values">
                    <div>
                      <span>Em aberto</span>
                      <strong>{money.format(open)}</strong>
                    </div>
                    <div>
                      <span>Disponível</span>
                      <strong>{money.format(available)}</strong>
                    </div>
                  </div>
                  <div className="card-limit-track">
                    <i style={{ width: utilization + "%" }} />
                  </div>
                  <div className="credit-card-footer">
                    <span>Fecha dia {card.closing_day} · vence dia {card.due_day}</span>
                    <div className="record-actions">
                      <button className="table-action edit" onClick={() => editCard(card)}>
                        Editar
                      </button>
                      <button className="table-action" onClick={() => void toggleCard(card)}>
                        {card.active ? "Desativar" : "Reativar"}
                      </button>
                      <button
                        className="table-action danger"
                        onClick={() => requestDeleteCard(card)}
                        disabled={deletingId === card.id}
                      >
                        {deletingId === card.id ? "Excluindo..." : "Excluir"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            {cards.length === 0 && (
              <div className="panel empty-state">
                <strong>Nenhum cartão cadastrado.</strong>
                <span>Cadastre o primeiro cartão para começar a controlar faturas.</span>
              </div>
            )}
          </section>

          <section className="panel table-panel card-statements">
            <div className="panel-title report-panel-title">
              <div>
                <h2>Faturas em aberto</h2>
                <p>Parcelas agrupadas pelo vencimento da fatura</p>
              </div>
            </div>

            {statements.length === 0 ? (
              <div className="empty-state">
                <strong>Nenhuma fatura em aberto.</strong>
                <span>As compras futuras aparecerão aqui.</span>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="card-statements-table">
                  <thead>
                    <tr>
                      <th>Cartão</th>
                      <th>Vencimento</th>
                      <th>Itens</th>
                      <th className="right">Total</th>
                      <th>Conta de pagamento</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((statement) => {
                      const card = cardMap.get(statement.cardId);
                      const statementKey = statement.cardId + "|" + statement.dueDate;
                      const defaultAccount =
                        statementAccounts[statementKey] ||
                        card?.default_payment_account_id ||
                        accounts[0]?.id ||
                        "";

                      return (
                        <tr key={statement.key}>
                          <td><strong>{cardNames.get(statement.cardId) ?? "Cartão"}</strong></td>
                          <td>
                            {new Date(statement.dueDate + "T12:00:00").toLocaleDateString("pt-BR")}
                          </td>
                          <td>
                            {statement.items.length} parcela(s)
                            <small className="cell-subtitle">
                              {statement.items.slice(0, 2).map((item) => item.description).join(" · ")}
                            </small>
                          </td>
                          <td className="right amount expense">
                            <strong>{money.format(statement.total)}</strong>
                          </td>
                          <td>
                            <select
                              className="statement-account"
                              value={defaultAccount}
                              onChange={(event) =>
                                setStatementAccounts((current) => ({
                                  ...current,
                                  [statementKey]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Selecione</option>
                              {accounts.map((account) => (
                                <option key={account.id} value={account.id}>{account.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="right">
                            <button
                              className="primary compact-primary"
                              disabled={!defaultAccount}
                              onClick={() => void payStatement(statement.cardId, statement.dueDate)}
                            >
                              Pagar fatura
                            </button>
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
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Excluir cartão?"
        description={pendingDelete ? `Você está prestes a excluir “${pendingDelete.name}”.` : ""}
        warning="As compras e parcelas já registradas serão preservadas no histórico, mas deixarão de ficar vinculadas ao cartão."
        confirmLabel="Excluir cartão"
        busy={Boolean(deletingId)}
        onCancel={() => { if (!deletingId) setPendingDelete(null); }}
        onConfirm={() => void confirmDeleteCard()}
      />
    </>
  );
}
