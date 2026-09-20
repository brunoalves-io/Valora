
import { useEffect, useState, type FormEvent } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    setSaving(true);
    setError("");

    const { error: insertError } = await supabase.from("cost_centers").insert({
      company_id: activeCompany.id,
      name: form.name.trim(),
      description: form.description.trim() || null,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setForm({ name: "", description: "" });
    setShowForm(false);
    setSaving(false);
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
        <button className="primary" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Fechar" : "+ Novo centro"}
        </button>
      </header>

      {showForm && (
        <form className="panel simple-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <h2>Novo centro de custo</h2>
              <p>Ex.: Administrativo, Marketing ou Loteamento A.</p>
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
            <button type="button" className="ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="primary" disabled={saving}>{saving ? "Salvando..." : "Salvar centro"}</button>
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
              <button className="table-action" onClick={() => void toggleActive(item)}>{item.active ? "Desativar" : "Reativar"}</button>
            </article>
          ))
        )}
      </section>
    </>
  );
}
