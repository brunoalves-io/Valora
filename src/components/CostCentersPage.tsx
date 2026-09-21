
import { useEffect, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";
import { getDeleteErrorMessage } from "../lib/deleteErrors";

type CostCenter = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
};

export function CostCentersPage() {
  const { activeCompany } = useCompany();
  const [items, setItems] = useState<CostCenter[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CostCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", description: "" });

  async function load() {
    if (!supabase || !activeCompany) return;
    setLoading(true);
    setError("");

    const { data, error: queryError } = await supabase
      .from("cost_centers")
      .select("id, name, description, active")
      .eq("company_id", activeCompany.id)
      .order("active", { ascending: false })
      .order("name");

    if (queryError) setError(queryError.message);
    else setItems((data ?? []) as CostCenter[]);

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id]);

  function resetForm() {
    setForm({ name: "", description: "" });
    setEditingId(null);
    setShowForm(false);
    setError("");
  }

  function openNewCostCenter() {
    setEditingId(null);
    setForm({ name: "", description: "" });
    setError("");
    setShowForm(true);
  }

  function editCostCenter(item: CostCenter) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description ?? "",
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
          .from("cost_centers")
          .update({
            name: form.name.trim(),
            description: form.description.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingId)
          .eq("company_id", activeCompany.id)
      : supabase.from("cost_centers").insert({
          company_id: activeCompany.id,
          name: form.name.trim(),
          description: form.description.trim() || null,
        });

    const { error: mutationError } = await mutation;

    if (mutationError) {
      setError(
        editingId
          ? "Não foi possível atualizar este centro de custo."
          : mutationError.message,
      );
      setSaving(false);
      return;
    }

    setSaving(false);
    resetForm();
    await load();
  }

  function requestDeleteCostCenter(item: CostCenter) {
    if (deletingId) return;
    setPendingDelete(item);
  }

  async function confirmDeleteCostCenter() {
    if (!supabase || !activeCompany || !pendingDelete || deletingId) return;
    const item = pendingDelete;
    setDeletingId(item.id);
    setError("");

    const { error: deleteError } = await supabase
      .from("cost_centers")
      .delete()
      .eq("id", item.id)
      .eq("company_id", activeCompany.id);

    if (deleteError) {
      setError(getDeleteErrorMessage(deleteError, "este centro de custo"));
      setDeletingId(null);
      setPendingDelete(null);
      return;
    }

    setDeletingId(null);
    setPendingDelete(null);
    await load();
  }

  async function toggleActive(item: CostCenter) {
    if (!supabase) return;

    const { error: updateError } = await supabase
      .from("cost_centers")
      .update({ active: !item.active, updated_at: new Date().toISOString() })
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
          <p className="eyebrow">ORGANIZAÇÃO</p>
          <h1>Centros de custo</h1>
          <p>Separe gastos e resultados por área, obra, empreendimento ou projeto.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            if (showForm) resetForm();
            else openNewCostCenter();
          }}
        >
          {showForm ? "Fechar" : "+ Novo centro"}
        </button>
      </header>

      {showForm && (
        <form className="panel simple-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>{editingId ? "Editar centro de custo" : "Novo centro de custo"}</h2>
              <p>
                {editingId
                  ? "Atualize o nome ou a descrição deste centro de custo."
                  : "Ex.: Administrativo, Marketing ou Loteamento A."}
              </p>
            </div>
          </div>
          <div className="simple-form-grid cost-center-form-grid">
            <label>
              Nome
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Administrativo" required />
            </label>
            <label>
              Descrição
              <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Opcional" />
            </label>
          </div>
          {error && <div className="form-alert error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={resetForm}>Cancelar</button>
            <button className="primary" disabled={saving}>
              {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Salvar centro"}
            </button>
          </div>
        </form>
      )}

      {!showForm && error && <div className="form-alert error page-alert">{error}</div>}

      <section className="management-grid">
        {loading ? (
          <div className="panel empty-state">Carregando centros de custo...</div>
        ) : items.length === 0 ? (
          <div className="panel empty-state"><strong>Nenhum centro de custo ainda.</strong><span>Crie o primeiro para começar a separar seus resultados.</span></div>
        ) : (
          items.map((item) => (
            <article className={item.active ? "management-card" : "management-card inactive"} key={item.id}>
              <div>
                <span className={item.active ? "status-badge active" : "status-badge"}>{item.active ? "Ativo" : "Inativo"}</span>
                <h2>{item.name}</h2>
                <p>{item.description || "Sem descrição."}</p>
              </div>
              <div className="record-actions">
                <button className="table-action edit" onClick={() => editCostCenter(item)}>
                  Editar
                </button>
                <button className="table-action" onClick={() => void toggleActive(item)}>
                  {item.active ? "Desativar" : "Reativar"}
                </button>
                <button
                  className="table-action danger"
                  onClick={() => requestDeleteCostCenter(item)}
                  disabled={deletingId === item.id}
                >
                  {deletingId === item.id ? "Excluindo..." : "Excluir"}
                </button>
              </div>
            </article>
          ))
        )}
      </section>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Excluir centro de custo?"
        description={pendingDelete ? `Você está prestes a excluir “${pendingDelete.name}”.` : ""}
        warning="Os lançamentos existentes serão preservados, mas ficarão sem este centro de custo."
        confirmLabel="Excluir centro de custo"
        busy={Boolean(deletingId)}
        onCancel={() => { if (!deletingId) setPendingDelete(null); }}
        onConfirm={() => void confirmDeleteCostCenter()}
      />
    </>
  );
}
