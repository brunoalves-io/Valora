import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import {
  isSafeRulePattern,
  type CategoryOption,
  type CategorizationRule,
} from "../lib/categorization";

type RuleDraft = {
  pattern: string;
  transactionType: "income" | "expense";
  categoryId: string;
};

type Props = {
  open: boolean;
  categories: CategoryOption[];
  rules: CategorizationRule[];
  canManage: boolean;
  initialDraft?: RuleDraft | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

const modeLabels: Record<CategorizationRule["match_mode"], string> = {
  contains: "Contém",
  starts_with: "Começa com",
  exact: "É exatamente",
};

const typeLabels = {
  income: "Receita",
  expense: "Despesa",
} as const;

export function CategorizationRulesDialog({
  open,
  categories,
  rules,
  canManage,
  initialDraft,
  onClose,
  onChanged,
}: Props) {
  const { activeCompany } = useCompany();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CategorizationRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    pattern: "",
    match_mode: "contains" as CategorizationRule["match_mode"],
    transaction_type: "expense" as "income" | "expense",
    category_id: "",
  });

  const availableCategories = useMemo(
    () =>
      categories.filter(
        (category) =>
          category.active !== false &&
          (category.type === form.transaction_type || category.type === "both"),
      ),
    [categories, form.transaction_type],
  );

  useEffect(() => {
    if (!open) return;

    const nextType = initialDraft?.transactionType ?? "expense";
    const compatible = categories.filter(
      (category) =>
        category.active !== false &&
        (category.type === nextType || category.type === "both"),
    );

    setEditingId(null);
    setError("");
    setForm({
      pattern: initialDraft?.pattern ?? "",
      match_mode: "contains",
      transaction_type: nextType,
      category_id:
        initialDraft?.categoryId &&
        compatible.some((category) => category.id === initialDraft.categoryId)
          ? initialDraft.categoryId
          : compatible[0]?.id ?? "",
    });
  }, [open, initialDraft, categories]);

  if (!open) return null;

  function resetForm() {
    const firstExpense = categories.find(
      (category) =>
        category.active !== false &&
        (category.type === "expense" || category.type === "both"),
    );

    setEditingId(null);
    setError("");
    setForm({
      pattern: "",
      match_mode: "contains",
      transaction_type: "expense",
      category_id: firstExpense?.id ?? "",
    });
  }

  function editRule(rule: CategorizationRule) {
    setEditingId(rule.id);
    setError("");
    setForm({
      pattern: rule.pattern,
      match_mode: rule.match_mode,
      transaction_type: rule.transaction_type,
      category_id: rule.category_id,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany || !canManage || saving) return;

    const pattern = form.pattern.trim();

    if (!isSafeRulePattern(pattern)) {
      setError(
        "Use uma palavra ou expressão específica, como “enel”, “uber” ou “claro internet”. Evite termos genéricos como “pagamento”.",
      );
      return;
    }

    if (!form.category_id) {
      setError("Selecione uma categoria para esta regra.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      company_id: activeCompany.id,
      pattern,
      match_mode: form.match_mode,
      transaction_type: form.transaction_type,
      category_id: form.category_id,
      priority: 100,
      active: true,
      updated_at: new Date().toISOString(),
    };

    const mutation = editingId
      ? supabase
          .from("bank_categorization_rules")
          .update(payload)
          .eq("id", editingId)
          .eq("company_id", activeCompany.id)
      : supabase.from("bank_categorization_rules").insert(payload);

    const { error: mutationError } = await mutation;

    if (mutationError) {
      setError(
        mutationError.code === "23505"
          ? "Já existe uma regra com este padrão, tipo e forma de comparação."
          : "Não foi possível salvar esta regra.",
      );
      setSaving(false);
      return;
    }

    setSaving(false);
    resetForm();
    await onChanged();
  }

  async function toggleRule(rule: CategorizationRule) {
    if (!supabase || !activeCompany || !canManage || busyRuleId) return;

    setBusyRuleId(rule.id);
    setError("");

    const { error: updateError } = await supabase
      .from("bank_categorization_rules")
      .update({
        active: !rule.active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rule.id)
      .eq("company_id", activeCompany.id);

    if (updateError) {
      setError("Não foi possível atualizar esta regra.");
      setBusyRuleId("");
      return;
    }

    setBusyRuleId("");
    await onChanged();
  }

  async function confirmDelete() {
    if (
      !supabase ||
      !activeCompany ||
      !canManage ||
      !pendingDelete ||
      busyRuleId
    ) {
      return;
    }

    const rule = pendingDelete;
    setBusyRuleId(rule.id);
    setError("");

    const { error: deleteError } = await supabase
      .from("bank_categorization_rules")
      .delete()
      .eq("id", rule.id)
      .eq("company_id", activeCompany.id);

    if (deleteError) {
      setError("Não foi possível excluir esta regra.");
      setBusyRuleId("");
      setPendingDelete(null);
      return;
    }

    if (editingId === rule.id) resetForm();
    setBusyRuleId("");
    setPendingDelete(null);
    await onChanged();
  }

  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <>
      <div className="categorization-rules-backdrop" role="presentation">
        <section
          className="categorization-rules-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="categorization-rules-title"
        >
          <header className="categorization-rules-header">
            <div>
              <span>ORGANIZAÇÃO AUTOMÁTICA</span>
              <h2 id="categorization-rules-title">Regras de categorização</h2>
              <p>
                Defina padrões para o Valora classificar movimentações bancárias de forma consistente.
              </p>
            </div>
            <button
              type="button"
              className="categorization-rules-close"
              onClick={onClose}
              aria-label="Fechar"
              title="Fechar"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6 18 18" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div className="categorization-rules-body">
            <form className="categorization-rule-form" onSubmit={submit}>
              <div className="categorization-rule-form-heading">
                <div>
                  <strong>{editingId ? "Editar regra" : "Nova regra"}</strong>
                  <span>
                    Regras têm prioridade sobre sugestões aprendidas pelo histórico.
                  </span>
                </div>
                {editingId && (
                  <button type="button" className="ghost" onClick={resetForm}>
                    Nova regra
                  </button>
                )}
              </div>

              <div className="categorization-rule-grid">
                <label className="categorization-rule-pattern">
                  Padrão da descrição
                  <input
                    value={form.pattern}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        pattern: event.target.value,
                      }))
                    }
                    placeholder="Ex.: enel, uber, claro internet"
                    maxLength={180}
                    required
                    disabled={!canManage || saving}
                  />
                  <small>
                    Prefira o nome do estabelecimento ou uma expressão estável.
                  </small>
                </label>

                <label>
                  Quando a descrição
                  <select
                    value={form.match_mode}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        match_mode: event.target
                          .value as CategorizationRule["match_mode"],
                      }))
                    }
                    disabled={!canManage || saving}
                  >
                    <option value="contains">Contém</option>
                    <option value="starts_with">Começa com</option>
                    <option value="exact">É exatamente</option>
                  </select>
                </label>

                <label>
                  Tipo
                  <select
                    value={form.transaction_type}
                    onChange={(event) => {
                      const transactionType = event.target.value as
                        | "income"
                        | "expense";
                      const compatible = categories.filter(
                        (category) =>
                          category.active !== false &&
                          (category.type === transactionType ||
                            category.type === "both"),
                      );

                      setForm((current) => ({
                        ...current,
                        transaction_type: transactionType,
                        category_id: compatible.some(
                          (category) => category.id === current.category_id,
                        )
                          ? current.category_id
                          : compatible[0]?.id ?? "",
                      }));
                    }}
                    disabled={!canManage || saving}
                  >
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </select>
                </label>

                <label>
                  Categoria
                  <select
                    value={form.category_id}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        category_id: event.target.value,
                      }))
                    }
                    disabled={!canManage || saving}
                    required
                  >
                    <option value="">Selecione</option>
                    {availableCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {error && <div className="form-alert error">{error}</div>}

              <div className="categorization-rule-form-actions">
                <span>
                  {canManage
                    ? "A regra será aplicada às próximas sugestões desta empresa."
                    : "Seu perfil pode visualizar, mas não alterar regras."}
                </span>
                <button
                  type="submit"
                  className="primary"
                  disabled={!canManage || saving}
                >
                  {saving
                    ? "Salvando..."
                    : editingId
                      ? "Salvar alterações"
                      : "Criar regra"}
                </button>
              </div>
            </form>

            <div className="categorization-rules-list">
              <div className="categorization-rules-list-heading">
                <div>
                  <strong>Regras cadastradas</strong>
                  <span>
                    {rules.length} regra{rules.length === 1 ? "" : "s"} nesta empresa
                  </span>
                </div>
              </div>

              {rules.length === 0 ? (
                <div className="categorization-rules-empty">
                  <strong>Nenhuma regra criada</strong>
                  <span>
                    Você pode criar uma manualmente ou partir de uma sugestão na conciliação.
                  </span>
                </div>
              ) : (
                <div className="categorization-rules-table-wrap">
                  <table className="categorization-rules-table">
                    <thead>
                      <tr>
                        <th>Padrão</th>
                        <th>Condição</th>
                        <th>Tipo</th>
                        <th>Categoria</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule) => (
                        <tr key={rule.id}>
                          <td>
                            <strong>{rule.pattern}</strong>
                          </td>
                          <td>{modeLabels[rule.match_mode]}</td>
                          <td>{typeLabels[rule.transaction_type]}</td>
                          <td>{categoryMap.get(rule.category_id) ?? "Categoria removida"}</td>
                          <td>
                            <span
                              className={
                                rule.active
                                  ? "categorization-rule-status active"
                                  : "categorization-rule-status"
                              }
                            >
                              {rule.active ? "Ativa" : "Pausada"}
                            </span>
                          </td>
                          <td className="right">
                            <div className="record-actions right">
                              <button
                                type="button"
                                className="table-action edit"
                                onClick={() => editRule(rule)}
                                disabled={!canManage || Boolean(busyRuleId)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="table-action"
                                onClick={() => void toggleRule(rule)}
                                disabled={!canManage || Boolean(busyRuleId)}
                              >
                                {rule.active ? "Pausar" : "Ativar"}
                              </button>
                              <button
                                type="button"
                                className="table-action danger"
                                onClick={() => setPendingDelete(rule)}
                                disabled={!canManage || Boolean(busyRuleId)}
                              >
                                Excluir
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Excluir regra?"
        description={
          pendingDelete
            ? `A regra “${pendingDelete.pattern}” deixará de sugerir categorias.`
            : ""
        }
        warning="As categorias já aplicadas aos lançamentos serão preservadas."
        confirmLabel="Excluir regra"
        busy={Boolean(busyRuleId)}
        onCancel={() => {
          if (!busyRuleId) setPendingDelete(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
