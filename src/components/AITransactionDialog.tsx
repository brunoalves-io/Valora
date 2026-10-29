import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Account = { id: string; name: string };
type Category = { id: string; name: string; type: "income" | "expense" | "both" };
type CostCenter = { id: string; name: string };
type Partner = {
  id: string;
  name: string;
  kind: "customer" | "supplier" | "both";
  active: boolean;
};
type TransactionTag = { id: string; name: string };

type Draft = {
  type: "income" | "expense" | null;
  description: string;
  amount: number | null;
  due_date: string;
  status: "paid" | "pending";
  account_id: string | null;
  category_id: string | null;
  cost_center_id: string | null;
  partner_id: string | null;
  tag_ids: string[];
  confidence: "high" | "medium" | "low";
  summary: string;
  warnings: string[];
};

type Props = {
  open: boolean;
  companyId: string;
  canManage: boolean;
  accounts: Account[];
  categories: Category[];
  costCenters: CostCenter[];
  partners: Partner[];
  tags: TransactionTag[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
};

const examples = [
  "Paguei R$ 189,90 de internet hoje pela conta Nubank",
  "Recebi R$ 850 do João hoje",
  "Comprei R$ 320 de insumos hoje",
];

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function moneyInput(value: number | null) {
  if (value === null) return "";
  return String(value).replace(".", ",");
}

function parseAmount(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  const parsed = clean.includes(",")
    ? Number(clean.replace(/\./g, "").replace(",", "."))
    : Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function friendlyError(message: string) {
  const normalized = message.toLocaleLowerCase("pt-BR");

  if (
    normalized.includes("get_ai_transaction_context") ||
    normalized.includes("create_transaction_with_tags")
  ) {
    return "A criação por IA ainda não foi ativada no banco. Aplique a migration 20261029_016_ai_transaction_creation.sql.";
  }

  if (
    normalized.includes("user message is required") ||
    normalized.includes("text is required")
  ) {
    return "A Edge Function Valora IA precisa ser atualizada para a versão que cria lançamentos.";
  }

  if (normalized.includes("rate limit") || normalized.includes("429")) {
    return "A Valora IA atingiu temporariamente o limite de solicitações. Tente novamente em instantes.";
  }

  return message;
}

export function AITransactionDialog({
  open,
  companyId,
  canManage,
  accounts,
  categories,
  costCenters,
  partners,
  tags,
  onClose,
  onCreated,
}: Props) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [amountText, setAmountText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setText("");
    setDraft(null);
    setAmountText("");
    setAnalyzing(false);
    setSaving(false);
    setError("");
  }, [open]);

  const visibleCategories = useMemo(
    () =>
      !draft?.type
        ? categories
        : categories.filter(
            (item) => item.type === draft.type || item.type === "both",
          ),
    [categories, draft?.type],
  );

  const visiblePartners = useMemo(
    () =>
      !draft?.type
        ? partners.filter((item) => item.active)
        : partners.filter(
            (item) =>
              item.active &&
              (item.kind === "both" ||
                (draft.type === "income" && item.kind === "customer") ||
                (draft.type === "expense" && item.kind === "supplier")),
          ),
    [partners, draft?.type],
  );

  async function analyze() {
    if (!supabase || !companyId || analyzing) return;

    const clean = text.trim();
    if (!clean) {
      setError("Descreva o lançamento que você quer criar.");
      return;
    }

    setAnalyzing(true);
    setError("");

    const { data, error: invokeError } = await supabase.functions.invoke(
      "valora-ai",
      {
        body: {
          mode: "transaction_draft",
          companyId,
          text: clean,
          today: localToday(),
        },
      },
    );

    if (invokeError || !data?.draft) {
      let message =
        invokeError?.message ||
        data?.error ||
        "A Valora IA não conseguiu preparar o lançamento.";

      const response = (invokeError as { context?: Response } | null)?.context;
      if (response) {
        try {
          const body = await response.clone().json();
          if (body?.error) message = body.error;
        } catch {
          // Keep the original Functions error.
        }
      }

      setError(friendlyError(String(message)));
      setAnalyzing(false);
      return;
    }

    const next = data.draft as Draft;
    setDraft({
      ...next,
      tag_ids: Array.isArray(next.tag_ids) ? next.tag_ids : [],
      warnings: Array.isArray(next.warnings) ? next.warnings : [],
      due_date: next.due_date || localToday(),
      status: next.status === "paid" ? "paid" : "pending",
    });
    setAmountText(moneyInput(next.amount));
    setAnalyzing(false);
  }

  function setType(type: "income" | "expense") {
    if (!draft) return;

    const categoryCompatible = categories.some(
      (item) =>
        item.id === draft.category_id &&
        (item.type === type || item.type === "both"),
    );
    const partnerCompatible = partners.some(
      (item) =>
        item.id === draft.partner_id &&
        (item.kind === "both" ||
          (type === "income" && item.kind === "customer") ||
          (type === "expense" && item.kind === "supplier")),
    );

    setDraft({
      ...draft,
      type,
      category_id: categoryCompatible ? draft.category_id : null,
      partner_id: partnerCompatible ? draft.partner_id : null,
    });
  }

  function toggleTag(tagId: string) {
    if (!draft) return;

    const selected = draft.tag_ids.includes(tagId);
    setDraft({
      ...draft,
      tag_ids: selected
        ? draft.tag_ids.filter((id) => id !== tagId)
        : [...draft.tag_ids, tagId],
    });
  }

  async function createTransaction() {
    if (!supabase || !draft || !canManage || saving) return;

    const amount = parseAmount(amountText);

    if (!draft.type) {
      setError("Escolha se o lançamento é uma receita ou despesa.");
      return;
    }

    if (!draft.description.trim()) {
      setError("Informe uma descrição.");
      return;
    }

    if (!amount) {
      setError("Informe um valor válido.");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.due_date)) {
      setError("Informe uma data válida.");
      return;
    }

    setSaving(true);
    setError("");

    const { error: createError } = await supabase.rpc(
      "create_transaction_with_tags",
      {
        p_company_id: companyId,
        p_type: draft.type,
        p_description: draft.description.trim(),
        p_amount: amount,
        p_due_date: draft.due_date,
        p_status: draft.status,
        p_account_id: draft.account_id || null,
        p_category_id: draft.category_id || null,
        p_cost_center_id: draft.cost_center_id || null,
        p_partner_id: draft.partner_id || null,
        p_tag_ids: draft.tag_ids,
      },
    );

    if (createError) {
      setError(friendlyError(createError.message));
      setSaving(false);
      return;
    }

    setSaving(false);
    await onCreated();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="ai-transaction-backdrop" role="presentation">
      <section
        className="ai-transaction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-transaction-title"
      >
        <header className="ai-transaction-header">
          <div>
            <span>VALORA IA</span>
            <h2 id="ai-transaction-title">Criar lançamento com IA</h2>
            <p>Descreva a movimentação como você falaria normalmente. Nada será salvo sem sua confirmação.</p>
          </div>
          <button
            type="button"
            className="transaction-organizer-close"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar"
            disabled={saving}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6 18 18" />
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="ai-transaction-body">
          <section className="ai-transaction-prompt">
            <label htmlFor="ai-transaction-text">
              O que aconteceu?
            </label>
            <textarea
              id="ai-transaction-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder='Ex.: "Paguei R$ 189,90 de internet hoje pela conta Nubank"'
              rows={3}
              maxLength={2000}
              disabled={analyzing || saving}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void analyze();
                }
              }}
            />

            {!draft && (
              <div className="ai-transaction-examples">
                {examples.map((example) => (
                  <button
                    type="button"
                    key={example}
                    onClick={() => setText(example)}
                    disabled={analyzing}
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}

            <div className="ai-transaction-analyze-row">
              <small>Enter analisa · Shift + Enter quebra a linha</small>
              <button
                type="button"
                className="primary"
                onClick={() => void analyze()}
                disabled={analyzing || saving || !text.trim()}
              >
                {analyzing
                  ? "Analisando..."
                  : draft
                    ? "Analisar novamente"
                    : "Preparar lançamento"}
              </button>
            </div>
          </section>

          {error && <div className="form-alert error">{error}</div>}

          {draft && (
            <section className="ai-transaction-preview">
              <div className="ai-transaction-preview-heading">
                <div>
                  <span>PRÉ-VISUALIZAÇÃO</span>
                  <h3>Revise antes de criar</h3>
                  {draft.summary && <p>{draft.summary}</p>}
                </div>
                <span className={"ai-confidence " + draft.confidence}>
                  {draft.confidence === "high"
                    ? "Confiança alta"
                    : draft.confidence === "low"
                      ? "Revisar com atenção"
                      : "Confiança média"}
                </span>
              </div>

              {draft.warnings.length > 0 && (
                <div className="ai-transaction-warnings">
                  {draft.warnings.map((warning) => (
                    <span key={warning}>{warning}</span>
                  ))}
                </div>
              )}

              <div className="ai-transaction-form-grid">
                <div className="ai-transaction-type wide">
                  <span>Tipo</span>
                  <div className="type-toggle">
                    <button
                      type="button"
                      className={draft.type === "expense" ? "selected expense" : ""}
                      onClick={() => setType("expense")}
                    >
                      Despesa
                    </button>
                    <button
                      type="button"
                      className={draft.type === "income" ? "selected income" : ""}
                      onClick={() => setType("income")}
                    >
                      Receita
                    </button>
                  </div>
                </div>

                <label className="wide">
                  Descrição
                  <input
                    value={draft.description}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                    maxLength={180}
                  />
                </label>

                <label>
                  Valor
                  <input
                    value={amountText}
                    onChange={(event) => setAmountText(event.target.value)}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                </label>

                <label>
                  Data
                  <input
                    type="date"
                    value={draft.due_date}
                    onChange={(event) =>
                      setDraft({ ...draft, due_date: event.target.value })
                    }
                  />
                </label>

                <label>
                  Status
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        status: event.target.value as "paid" | "pending",
                      })
                    }
                  >
                    <option value="paid">Pago / recebido</option>
                    <option value="pending">Pendente</option>
                  </select>
                </label>

                <label>
                  Conta
                  <select
                    value={draft.account_id ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        account_id: event.target.value || null,
                      })
                    }
                  >
                    <option value="">Sem conta</option>
                    {accounts.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Categoria
                  <select
                    value={draft.category_id ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        category_id: event.target.value || null,
                      })
                    }
                  >
                    <option value="">Sem categoria</option>
                    {visibleCategories.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Centro de custo
                  <select
                    value={draft.cost_center_id ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        cost_center_id: event.target.value || null,
                      })
                    }
                  >
                    <option value="">Sem centro de custo</option>
                    {costCenters.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  {draft.type === "income" ? "Cliente" : "Fornecedor"}
                  <select
                    value={draft.partner_id ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        partner_id: event.target.value || null,
                      })
                    }
                  >
                    <option value="">Sem vínculo</option>
                    {visiblePartners.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>

                {tags.length > 0 && (
                  <div className="ai-transaction-tags wide">
                    <span>Tags</span>
                    <div>
                      {tags.map((tag) => (
                        <button
                          type="button"
                          key={tag.id}
                          className={
                            draft.tag_ids.includes(tag.id)
                              ? "transaction-tag selected"
                              : "transaction-tag"
                          }
                          onClick={() => toggleTag(tag.id)}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <footer className="ai-transaction-actions">
          <span>
            {draft
              ? "O lançamento só será criado depois da sua confirmação."
              : "A IA usa os dados e o histórico desta empresa para sugerir os campos."}
          </span>
          <div>
            <button
              type="button"
              className="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void createTransaction()}
              disabled={!draft || !canManage || saving || analyzing}
            >
              {saving ? "Criando..." : "Criar lançamento"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
