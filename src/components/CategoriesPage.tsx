
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    setSaving(true);
    setError("");

    const { error: insertError } = await supabase.from("categories").insert({
      company_id: activeCompany.id,
      name: form.name.trim(),
      type: form.type,
      parent_id: form.parent_id || null,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setForm({ name: "", type: "expense", parent_id: "" });
    setShowForm(false);
    setSaving(false);
    await load();
  }

  async function deleteCategory(category: Category) {
    if (!supabase || !activeCompany || deletingId) return;

    const confirmed = window.confirm(
      `Excluir a categoria "${category.name}"?\n\nLançamentos existentes serão mantidos sem esta categoria. Subcategorias também serão preservadas e passarão a ficar sem categoria principal.`,
    );
    if (!confirmed) return;

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
      return;
    }

    setDeletingId(null);
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
        <button className="primary" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Nova categoria"}
        </button>
      </header>

      {showForm && (
        <form className="panel simple-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>Nova categoria</h2>
              <p>Para criar uma subcategoria, selecione uma categoria principal.</p>
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
                {parentOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
          </div>
          {error && <div className="form-alert error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="primary" disabled={saving}>{saving ? "Salvando..." : "Salvar categoria"}</button>
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
                        <button className="table-action" onClick={() => void toggleActive(category)}>
                          {category.active ? "Desativar" : "Reativar"}
                        </button>
                        <button
                          className="table-action danger"
                          onClick={() => void deleteCategory(category)}
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
    </>
  );
}
