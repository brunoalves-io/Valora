import type { ReactNode } from "react";

export type AITransactionDraft = {
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

export type AIRecurrenceDraft = {
  type: "income" | "expense" | null;
  description: string;
  amount: number | null;
  frequency: "weekly" | "monthly" | "yearly";
  interval_count: number;
  start_date: string;
  end_date: string | null;
  account_id: string | null;
  category_id: string | null;
  cost_center_id: string | null;
  partner_id: string | null;
  confidence: "high" | "medium" | "low";
  summary: string;
  warnings: string[];
};

export type AIOperationAction =
  | { type: "create_transaction"; draft: AITransactionDraft }
  | { type: "create_recurrence"; draft: AIRecurrenceDraft };

export type AIActionStatus = "proposed" | "confirmed" | "cancelled" | "failed";

type NameMaps = {
  accounts: Map<string, string>;
  categories: Map<string, string>;
  costCenters: Map<string, string>;
  partners: Map<string, string>;
  tags: Map<string, string>;
};

type Props = {
  action: AIOperationAction;
  actionId: string;
  status: AIActionStatus;
  errorMessage?: string | null;
  names: NameMaps;
  canManage: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDate(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Date(value + "T12:00:00").toLocaleDateString("pt-BR");
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="ai-operation-field">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function nameOrFallback(
  map: Map<string, string>,
  id: string | null,
  fallback: string,
) {
  return id ? map.get(id) ?? fallback : fallback;
}

export function AIOperationCard({
  action,
  actionId,
  status,
  errorMessage,
  names,
  canManage,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const draft = action.draft;
  const transactionDraft =
    action.type === "create_transaction" ? action.draft : null;
  const recurrenceDraft =
    action.type === "create_recurrence" ? action.draft : null;
  const isTransaction = Boolean(transactionDraft);
  const title = isTransaction
    ? draft.type === "income"
      ? "Nova receita"
      : "Nova despesa"
    : draft.type === "income"
      ? "Nova receita recorrente"
      : "Nova despesa recorrente";

  const statusLabel =
    status === "confirmed"
      ? "Confirmada"
      : status === "cancelled"
        ? "Cancelada"
        : status === "failed"
          ? "Falhou"
          : "Aguardando confirmação";

  const confidenceLabel =
    draft.confidence === "high"
      ? "Alta confiança"
      : draft.confidence === "medium"
        ? "Confiança média"
        : "Baixa confiança";

  return (
    <section className={"ai-operation-card " + status}>
      <header className="ai-operation-card-header">
        <div>
          <span className="ai-operation-kicker">
            {isTransaction ? "AÇÃO FINANCEIRA" : "AUTOMAÇÃO FINANCEIRA"}
          </span>
          <h3>{title}</h3>
          <p>{draft.summary || "Revise os dados antes de confirmar."}</p>
        </div>
        <div className="ai-operation-card-badges">
          <span className={"confidence " + draft.confidence}>
            {confidenceLabel}
          </span>
          <span className={"status " + status}>{statusLabel}</span>
        </div>
      </header>

      <div className="ai-operation-grid">
        <Field label="Descrição">{draft.description || "Não informada"}</Field>
        <Field label="Valor">
          {draft.amount ? money.format(draft.amount) : "Não informado"}
        </Field>
        <Field label="Tipo">
          {draft.type === "income"
            ? "Receita"
            : draft.type === "expense"
              ? "Despesa"
              : "Revisar"}
        </Field>

        {transactionDraft ? (
          <>
            <Field label="Data">{formatDate(transactionDraft.due_date)}</Field>
            <Field label="Status">
              {transactionDraft.status === "paid" ? "Pago / recebido" : "Pendente"}
            </Field>
          </>
        ) : recurrenceDraft ? (
          <>
            <Field label="Início">{formatDate(recurrenceDraft.start_date)}</Field>
            <Field label="Frequência">
              {recurrenceDraft.frequency === "weekly"
                ? "Semanal"
                : recurrenceDraft.frequency === "monthly"
                  ? "Mensal"
                  : "Anual"}
              {recurrenceDraft.interval_count > 1
                ? ` · a cada ${recurrenceDraft.interval_count} ${recurrenceDraft.frequency === "weekly" ? "semanas" : recurrenceDraft.frequency === "monthly" ? "meses" : "anos"}`
                : ""}
            </Field>
            <Field label="Término">
              {recurrenceDraft.end_date
                ? formatDate(recurrenceDraft.end_date)
                : "Sem término"}
            </Field>
          </>
        ) : null}

        <Field label="Conta">
          {nameOrFallback(names.accounts, draft.account_id, "Sem conta definida")}
        </Field>
        <Field label="Categoria">
          {nameOrFallback(names.categories, draft.category_id, "Sem categoria")}
        </Field>
        <Field label="Centro de custo">
          {nameOrFallback(
            names.costCenters,
            draft.cost_center_id,
            "Sem centro de custo",
          )}
        </Field>
        <Field label={draft.type === "income" ? "Cliente" : "Fornecedor"}>
          {nameOrFallback(names.partners, draft.partner_id, "Sem vínculo")}
        </Field>

        {transactionDraft && transactionDraft.tag_ids.length > 0 && (
          <Field label="Tags">
            {transactionDraft.tag_ids
              .map((id) => names.tags.get(id) ?? "Tag")
              .join(", ")}
          </Field>
        )}
      </div>

      {draft.warnings.length > 0 && (
        <div className="ai-operation-warnings">
          {draft.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}

      {status === "failed" && errorMessage && (
        <div className="ai-operation-failure">{errorMessage}</div>
      )}

      <footer className="ai-operation-card-footer">
        <small>
          ID da proposta: {actionId.slice(0, 8)} · Nenhuma alteração acontece sem confirmação.
        </small>

        {status === "proposed" && (
          <div>
            <button
              type="button"
              className="ghost"
              onClick={onCancel}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary"
              onClick={onConfirm}
              disabled={busy || !canManage}
              title={
                canManage
                  ? "Confirmar esta ação"
                  : "Seu perfil não permite alterações financeiras"
              }
            >
              {busy ? "Processando..." : isTransaction ? "Confirmar lançamento" : "Confirmar recorrência"}
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}
