import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type CompanySettings = {
  name: string;
  legal_name: string;
  tax_id: string;
  state_registration: string;
  municipal_registration: string;
  email: string;
  phone: string;
  website: string;
  address_street: string;
  address_number: string;
  address_complement: string;
  address_district: string;
  address_city: string;
  address_state: string;
  postal_code: string;
  country_code: string;
  currency_code: string;
  locale: string;
  timezone: string;
  logo_url: string;
};

const emptySettings: CompanySettings = {
  name: "",
  legal_name: "",
  tax_id: "",
  state_registration: "",
  municipal_registration: "",
  email: "",
  phone: "",
  website: "",
  address_street: "",
  address_number: "",
  address_complement: "",
  address_district: "",
  address_city: "",
  address_state: "",
  postal_code: "",
  country_code: "BR",
  currency_code: "BRL",
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
  logo_url: "",
};

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function formatTaxId(value: string) {
  const clean = digits(value).slice(0, 14);

  if (clean.length <= 11) {
    return clean
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }

  return clean
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function formatPostalCode(value: string) {
  return digits(value)
    .slice(0, 8)
    .replace(/^(\d{5})(\d)/, "$1-$2");
}

function formatPhone(value: string) {
  const clean = digits(value).slice(0, 11);
  if (clean.length <= 10) {
    return clean
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }

  return clean
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

function cleanNullable(value: string) {
  const clean = value.trim();
  return clean || null;
}

export function CompanySettingsPage() {
  const { activeCompany, activeRole, refreshCompanies } = useCompany();
  const [form, setForm] = useState<CompanySettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canEdit = activeRole === "owner" || activeRole === "admin";

  useEffect(() => {
    if (!supabase || !activeCompany) return;

    const client = supabase;
    const companyId = activeCompany.id;

    async function load() {
      setLoading(true);
      setError("");
      setMessage("");

      const { data, error: queryError } = await client
        .from("companies")
        .select(
          "name, legal_name, tax_id, state_registration, municipal_registration, email, phone, website, address_street, address_number, address_complement, address_district, address_city, address_state, postal_code, country_code, currency_code, locale, timezone, logo_url",
        )
        .eq("id", companyId)
        .single();

      if (queryError || !data) {
        setError(queryError?.message || "Não foi possível carregar os dados da empresa.");
        setLoading(false);
        return;
      }

      const row = data as unknown as Partial<CompanySettings> & { name: string };

      setForm({
        name: row.name ?? "",
        legal_name: row.legal_name ?? "",
        tax_id: row.tax_id ?? "",
        state_registration: row.state_registration ?? "",
        municipal_registration: row.municipal_registration ?? "",
        email: row.email ?? "",
        phone: row.phone ?? "",
        website: row.website ?? "",
        address_street: row.address_street ?? "",
        address_number: row.address_number ?? "",
        address_complement: row.address_complement ?? "",
        address_district: row.address_district ?? "",
        address_city: row.address_city ?? "",
        address_state: row.address_state ?? "",
        postal_code: row.postal_code ?? "",
        country_code: row.country_code ?? "BR",
        currency_code: row.currency_code ?? "BRL",
        locale: row.locale ?? "pt-BR",
        timezone: row.timezone ?? "America/Sao_Paulo",
        logo_url: row.logo_url ?? "",
      });

      setLoading(false);
    }

    void load();
  }, [activeCompany?.id]);

  const completeness = useMemo(() => {
    const fields = [
      form.name,
      form.legal_name,
      form.tax_id,
      form.email,
      form.phone,
      form.address_street,
      form.address_city,
      form.address_state,
      form.postal_code,
    ];
    const filled = fields.filter((value) => value.trim().length > 0).length;
    return Math.round((filled / fields.length) * 100);
  }, [form]);

  function update<K extends keyof CompanySettings>(
    field: K,
    value: CompanySettings[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
    setError("");
  }

  async function uploadLogo(file: File) {
    if (!supabase || !activeCompany || !canEdit || logoBusy) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setError("Use uma imagem PNG, JPG ou WebP.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("A logo deve ter no máximo 5 MB.");
      return;
    }

    setLogoBusy(true);
    setError("");
    setMessage("");

    const objectPath = `${activeCompany.id}/logo`;
    const { error: uploadError } = await supabase.storage
      .from("company-branding")
      .upload(objectPath, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: "3600",
      });

    if (uploadError) {
      setError("Não foi possível enviar a logo. Tente novamente.");
      setLogoBusy(false);
      return;
    }

    const { data: publicData } = supabase.storage
      .from("company-branding")
      .getPublicUrl(objectPath);

    const publicUrl = publicData.publicUrl + "?v=" + Date.now();

    const { error: companyError } = await supabase
      .from("companies")
      .update({
        logo_url: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeCompany.id);

    if (companyError) {
      setError("A imagem foi enviada, mas não foi possível vinculá-la à empresa.");
      setLogoBusy(false);
      return;
    }

    update("logo_url", publicUrl);
    await refreshCompanies();
    setMessage("Logo atualizada com sucesso.");
    setLogoBusy(false);
  }

  async function removeLogo() {
    if (!supabase || !activeCompany || !canEdit || logoBusy || !form.logo_url) return;

    const confirmed = window.confirm("Remover a logo atual da empresa?");
    if (!confirmed) return;

    setLogoBusy(true);
    setError("");
    setMessage("");

    const objectPath = `${activeCompany.id}/logo`;
    await supabase.storage.from("company-branding").remove([objectPath]);

    const { error: companyError } = await supabase
      .from("companies")
      .update({
        logo_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeCompany.id);

    if (companyError) {
      setError("Não foi possível remover a logo da empresa.");
      setLogoBusy(false);
      return;
    }

    update("logo_url", "");
    await refreshCompanies();
    setMessage("Logo removida.");
    setLogoBusy(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany || !canEdit) return;

    if (form.name.trim().length < 2) {
      setError("Informe um nome válido para a empresa.");
      return;
    }

    const taxLength = digits(form.tax_id).length;
    if (form.tax_id.trim() && taxLength !== 11 && taxLength !== 14) {
      setError("O CPF/CNPJ deve ter 11 ou 14 dígitos.");
      return;
    }

    if (form.address_state.trim() && form.address_state.trim().length !== 2) {
      setError("Use a sigla de 2 letras para o estado, como CE ou SP.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const { error: updateError } = await supabase
      .from("companies")
      .update({
        name: form.name.trim(),
        legal_name: cleanNullable(form.legal_name),
        tax_id: cleanNullable(form.tax_id),
        state_registration: cleanNullable(form.state_registration),
        municipal_registration: cleanNullable(form.municipal_registration),
        email: cleanNullable(form.email),
        phone: cleanNullable(form.phone),
        website: cleanNullable(form.website),
        address_street: cleanNullable(form.address_street),
        address_number: cleanNullable(form.address_number),
        address_complement: cleanNullable(form.address_complement),
        address_district: cleanNullable(form.address_district),
        address_city: cleanNullable(form.address_city),
        address_state: cleanNullable(form.address_state.toUpperCase()),
        postal_code: cleanNullable(form.postal_code),
        country_code: form.country_code,
        currency_code: form.currency_code,
        locale: form.locale,
        timezone: form.timezone,
        logo_url: cleanNullable(form.logo_url),
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeCompany.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    await refreshCompanies();
    setMessage("Configurações da empresa salvas com sucesso.");
    setSaving(false);
  }

  if (loading) {
    return <section className="panel empty-state">Carregando configurações...</section>;
  }

  return (
    <>
      <header className="page-header split settings-page-header">
        <div>
          <p className="eyebrow">ADMINISTRAÇÃO</p>
          <h1>Configurações da empresa</h1>
          <p>Centralize os dados cadastrais e a identidade da empresa no Valora.</p>
        </div>

        <div className="company-completeness">
          <div className="company-completeness-ring" style={{ "--progress": completeness } as CSSProperties}>
            <strong>{completeness}%</strong>
          </div>
          <div>
            <strong>Cadastro da empresa</strong>
            <span>
              {completeness === 100
                ? "Tudo preenchido"
                : "Complete os dados para deixar o Valora pronto para documentos e relatórios."}
            </span>
          </div>
        </div>
      </header>

      {!canEdit && (
        <div className="viewer-banner settings-readonly">
          Você pode consultar estas configurações. Apenas Líder e Administrador podem alterá-las.
        </div>
      )}

      {error && <div className="form-alert error page-alert">{error}</div>}
      {message && <div className="form-alert success page-alert">{message}</div>}

      <form className="company-settings-form" onSubmit={save}>
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <div className="settings-section-heading-copy">
              <h2>Empresa</h2>
              <p>Dados principais usados para identificar sua operação.</p>
            </div>
          </div>

          <div className="settings-grid">
            <label className="wide">
              Nome no Valora
              <input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                disabled={!canEdit}
                maxLength={120}
                required
              />
              <small>É o nome exibido no menu, Dashboard e demais módulos.</small>
            </label>

            <label className="wide">
              Razão social / nome completo
              <input
                value={form.legal_name}
                onChange={(event) => update("legal_name", event.target.value)}
                disabled={!canEdit}
                maxLength={180}
                placeholder="Nome empresarial registrado"
              />
            </label>

            <label>
              CPF / CNPJ
              <input
                value={form.tax_id}
                onChange={(event) => update("tax_id", formatTaxId(event.target.value))}
                disabled={!canEdit}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
              />
            </label>

            <label>
              Inscrição estadual
              <input
                value={form.state_registration}
                onChange={(event) => update("state_registration", event.target.value)}
                disabled={!canEdit}
                maxLength={40}
                placeholder="Opcional"
              />
            </label>

            <label>
              Inscrição municipal
              <input
                value={form.municipal_registration}
                onChange={(event) => update("municipal_registration", event.target.value)}
                disabled={!canEdit}
                maxLength={40}
                placeholder="Opcional"
              />
            </label>

            <label>
              País
              <select
                value={form.country_code}
                onChange={(event) => update("country_code", event.target.value)}
                disabled={!canEdit}
              >
                <option value="BR">Brasil</option>
              </select>
            </label>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="settings-section-heading">
            <div className="settings-section-heading-copy">
              <h2>Contato</h2>
              <p>Informações que poderão ser reutilizadas em propostas e documentos.</p>
            </div>
          </div>

          <div className="settings-grid">
            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                disabled={!canEdit}
                maxLength={160}
                placeholder="financeiro@empresa.com.br"
              />
            </label>

            <label>
              Telefone
              <input
                value={form.phone}
                onChange={(event) => update("phone", formatPhone(event.target.value))}
                disabled={!canEdit}
                inputMode="tel"
                placeholder="(00) 00000-0000"
              />
            </label>

            <label className="wide">
              Site
              <input
                value={form.website}
                onChange={(event) => update("website", event.target.value)}
                disabled={!canEdit}
                maxLength={240}
                placeholder="https://suaempresa.com.br"
              />
            </label>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="settings-section-heading">
            <div className="settings-section-heading-copy">
              <h2>Endereço</h2>
              <p>Endereço comercial ou fiscal da empresa.</p>
            </div>
          </div>

          <div className="settings-grid address-settings-grid">
            <label className="street-field">
              Logradouro
              <input
                value={form.address_street}
                onChange={(event) => update("address_street", event.target.value)}
                disabled={!canEdit}
                maxLength={180}
                placeholder="Rua, avenida..."
              />
            </label>

            <label className="number-field">
              Número
              <input
                value={form.address_number}
                onChange={(event) => update("address_number", event.target.value)}
                disabled={!canEdit}
                maxLength={30}
              />
            </label>

            <label>
              Complemento
              <input
                value={form.address_complement}
                onChange={(event) => update("address_complement", event.target.value)}
                disabled={!canEdit}
                maxLength={100}
                placeholder="Sala, bloco..."
              />
            </label>

            <label>
              Bairro
              <input
                value={form.address_district}
                onChange={(event) => update("address_district", event.target.value)}
                disabled={!canEdit}
                maxLength={100}
              />
            </label>

            <label>
              Cidade
              <input
                value={form.address_city}
                onChange={(event) => update("address_city", event.target.value)}
                disabled={!canEdit}
                maxLength={100}
              />
            </label>

            <label className="state-field">
              UF
              <input
                value={form.address_state}
                onChange={(event) =>
                  update("address_state", event.target.value.toUpperCase().slice(0, 2))
                }
                disabled={!canEdit}
                maxLength={2}
                placeholder="CE"
              />
            </label>

            <label>
              CEP
              <input
                value={form.postal_code}
                onChange={(event) =>
                  update("postal_code", formatPostalCode(event.target.value))
                }
                disabled={!canEdit}
                inputMode="numeric"
                placeholder="00000-000"
              />
            </label>
          </div>
        </section>

        <section className="panel settings-section settings-brand-section">
          <div className="settings-section-heading">
            <div className="settings-section-heading-copy">
              <h2>Identidade</h2>
              <p>Prepare a marca para futuras propostas e documentos gerados pelo Valora.</p>
            </div>
          </div>

          <div className="company-brand-settings">
            <div className="company-logo-preview">
              {form.logo_url ? (
                <img
                  key={form.logo_url}
                  src={form.logo_url}
                  alt="Logo da empresa"
                  onLoad={(event) => {
                    event.currentTarget.style.display = "block";
                  }}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <span>{form.name.trim().slice(0, 1).toUpperCase() || "V"}</span>
              )}
            </div>

            <div className="company-logo-controls">
              <div>
                <strong>Logo da empresa</strong>
                <span>PNG, JPG ou WebP, até 5 MB.</span>
              </div>

              <div className="company-logo-actions">
                <label
                  className={
                    canEdit && !logoBusy
                      ? "company-logo-upload"
                      : "company-logo-upload disabled"
                  }
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!canEdit || logoBusy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void uploadLogo(file);
                    }}
                  />
                  {logoBusy ? "Enviando..." : form.logo_url ? "Trocar logo" : "Enviar logo"}
                </label>

                {form.logo_url && canEdit && (
                  <button
                    type="button"
                    className="table-action danger company-logo-remove"
                    onClick={() => void removeLogo()}
                    disabled={logoBusy}
                  >
                    Remover
                  </button>
                )}
              </div>

              <label className="company-logo-url">
                Ou use uma URL pública
                <input
                  type="url"
                  value={form.logo_url}
                  onChange={(event) => update("logo_url", event.target.value)}
                  disabled={!canEdit || logoBusy}
                  placeholder="https://..."
                />
                <small>
                  O upload direto salva a imagem automaticamente. A URL continua disponível como alternativa.
                </small>
              </label>
            </div>
          </div>
        </section>

        <section className="panel settings-section settings-preferences">
          <div className="settings-section-heading">
            <div className="settings-section-heading-copy">
              <h2>Preferências</h2>
              <p>Base regional usada internamente pelo Valora.</p>
            </div>
          </div>

          <div className="settings-preference-list">
            <div>
              <span>Moeda</span>
              <strong>Real brasileiro (BRL)</strong>
            </div>
            <div>
              <span>Idioma</span>
              <strong>Português do Brasil</strong>
            </div>
            <div>
              <span>Fuso horário</span>
              <strong>America/Sao_Paulo</strong>
            </div>
          </div>
        </section>

        {canEdit && (
          <div className="settings-save-bar">
            <div>
              <strong>Alterações auditadas</strong>
              <span>Toda atualização fica registrada no histórico administrativo.</span>
            </div>
            <button className="primary settings-save-button" disabled={saving}>
              {saving ? "Salvando..." : "Salvar configurações"}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
