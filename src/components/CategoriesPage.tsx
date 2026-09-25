
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import { getDeleteErrorMessage } from "../lib/deleteErrors";

type CategoryType = "income" | "expense" | "both";
type Category = {
  id: string;
  name: string;
  type: CategoryType;
  active: boolean;
  parent_id: string | null;
};

const typeLabels: Record<CategoryType, string> = {
  income: "Receita",
  expense: "Despesa",
  both: "Ambos",
};

export function CategoriesPage() {
  const { activeCompany } = useCompany();
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "expense" as CategoryType,
    parent_id: "",
  });

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);
    setError("");

    const { data, error: queryError } = await supabase
      .from("categories")
      .select("id, name, type, active, parent_id")
      .eq("company_id", activeCompany.id)
      .order("name");

    if (queryError) setError(queryError.message);
    else setCategories((data ?? []) as Category[]);

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  const parentOptions = useMemo(
    () =>
      categories.filter(
        (category) =>
          !category.parent_id &&
          category.active &&
          (category.type === form.type || category.type === "both" || form.type === "both"),
      ),
    [categories, form.type],
  );

  const parentMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  function resetForm() {
    setForm({ name: "", type: "expense", parent_id: "" });
    setEditingId(null);
    setShowForm(false);
    setError("");
  }

  function openNewCategory() {
    setEditingId(null);
    setForm({ name: "", type: "expense", parent_id: "" });
    setError("");
    setShowForm(true);
  }

  function editCategory(category: Category) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      type: category.type,
      parent_id: category.parent_id ?? "",
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

    const mutation = editingId
      ? supabase
          .from("categories")
          .update({
            name: form.name.trim(),
            type: form.type,
            parent_id: form.parent_id || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingId)
          .eq("company_id", activeCompany.id)
      : supabase.from("categories").insert({
          company_id: activeCompany.id,
          name: form.name.trim(),
          type: form.type,
          parent_id: form.parent_id || null,
        });

    const { error: mutationError } = await mutation;

    if (mutationError) {
      setError(
        editingId ? "Não foi possível atualizar esta categoria." : mutationError.message,
      );
      setSaving(false);
      return;
    }

    setSaving(false);
    resetForm();
    await load();
  }

  function requestDeleteCategory(category: Category) {
    if (deletingId) return;
    setPendingDelete(category);
  }

  async function confirmDeleteCategory() {
    if (!supabase || !activeCompany || !pendingDelete || deletingId) return;
    const category = pendingDelete;
    setDeletingId(category.id);
    setError("");

    const { error: deleteError } = await supabase
      .from("categories")
      .delete()
      .eq("id", category.id)
      .eq("company_id", activeCompany.id);

    if (deleteError) {
      setError(getDeleteErrorMessage(deleteError, "esta categoria"));
      setDeletingId(null);
      setPendingDelete(null);
      return;
    }

    setDeletingId(null);
    setPendingDelete(null);
    await load();
  }

  async function toggleActive(category: Category) {
    if (!supabase) return;

    const { error: updateError } = await supabase
      .from("categories")
      .update({ active: !category.active })
      .eq("id", category.id);

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
          <p className="eyebrow">ORGANIZAÇÃO</p>
          <h1>Categorias</h1>
          <p>Estruture receitas e despesas com categorias e subcategorias.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            if (showForm) resetForm();
            else openNewCategory();
          }}
        >
          {showForm ? "Fechar" : "+ Nova categoria"}
        </button>
      </header>

      {showForm && (
        <form className="panel simple-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>{editingId ? "Editar categoria" : "Nova categoria"}</h2>
              <p>
                {editingId
                  ? "Atualize nome, tipo ou vínculo com a categoria principal."
                  : "Para criar uma subcategoria, selecione uma categoria principal."}
              </p>
            </div>
          </div>
          <div className="simple-form-grid">
            <label>
              Nome
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Software" required />
            </label>
            <label>
              Tipo
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as CategoryType, parent_id: "" })}>
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
                <option value="both">Ambos</option>
              </select>
            </label>
            <label>
              Categoria principal
              <select value={form.parent_id} onChange={(event) => setForm({ ...form, parent_id: event.target.value })}>
                <option value="">Nenhuma</option>
                {parentOptions
                  .filter((category) => category.id !== editingId)
                  .map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
          </div>
          {error && <div className="form-alert error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={resetForm}>Cancelar</button>
            <button className="primary" disabled={saving}>
              {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Salvar categoria"}
            </button>
          </div>
        </form>
      )}

      {!showForm && error && <div className="form-alert error page-alert">{error}</div>}

      <section className="panel table-panel">
        {loading ? (
          <div className="empty-state">Carregando categorias...</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Categoria</th><th>Tipo</th><th>Nível</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <strong>{category.parent_id ? "↳ " : ""}{category.name}</strong>
                      {category.parent_id && <small className="cell-subtitle">Dentro de {parentMap.get(category.parent_id) ?? "Categoria"}</small>}
                    </td>
                    <td><span className={"pill " + category.type}>{typeLabels[category.type]}</span></td>
                    <td>{category.parent_id ? "Subcategoria" : "Principal"}</td>
                    <td>{category.active ? "Ativa" : "Inativa"}</td>
                    <td className="right">
                      <div className="record-actions right">
                        <button className="table-action edit" onClick={() => editCategory(category)}>
                          Editar
                        </button>
                        <button className="table-action" onClick={() => void toggleActive(category)}>
                          {category.active ? "Desativar" : "Reativar"}
                        </button>
                        <button
                          className="table-action danger"
                          onClick={() => requestDeleteCategory(category)}
                          disabled={deletingId === category.id}
                        >
                          {deletingId === category.id ? "Excluindo..." : "Excluir"}
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
        title="Excluir categoria?"
        description={pendingDelete ? `Você está prestes a excluir “${pendingDelete.name}”.` : ""}
        warning="Lançamentos serão preservados sem a categoria. Subcategorias também ficarão sem categoria principal."
        confirmLabel="Excluir categoria"
        busy={Boolean(deletingId)}
        onCancel={() => { if (!deletingId) setPendingDelete(null); }}
        onConfirm={() => void confirmDeleteCategory()}
      />
    </>
  );
}
