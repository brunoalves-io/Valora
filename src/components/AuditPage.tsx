
import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type AuditLog = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown>;
  created_at: string;
};

type TeamMember = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  joined_at: string;
};

const actionLabels: Record<string, string> = {
  created: "Criou",
  updated: "Alterou",
  deleted: "Excluiu",
  settled: "Baixou",
  cancelled: "Cancelou",
  invited: "Convidou",
  joined: "Entrou",
  role_changed: "Alterou permissão",
  removed: "Removeu",
  invitation_cancelled: "Cancelou convite",
};

const entityLabels: Record<string, string> = {
  transactions: "Lançamento",
  financial_accounts: "Conta / caixa",
  categories: "Categoria",
  cost_centers: "Centro de custo",
  business_partners: "Cliente / fornecedor",
  proposals: "Proposta",
  credit_cards: "Cartão",
  recurring_rules: "Recorrência",
  automation_rules: "Regra de automação",
  companies: "Configurações da empresa",
  team_member: "Membro da equipe",
  team_invitation: "Convite",
};

function pickRecord(changes: Record<string, unknown>) {
  const after = changes.after;
  const before = changes.before;
  if (after && typeof after === "object") return after as Record<string, unknown>;
  if (before && typeof before === "object") return before as Record<string, unknown>;
  return changes;
}

function describeLog(log: AuditLog) {
  const record = pickRecord(log.changes);
  const candidates = [
    record.description,
    record.name,
    record.title,
    record.email,
    record.proposal_number ? `Proposta #${record.proposal_number}` : null,
    record.last_four ? `•••• ${record.last_four}` : null,
  ];

  const value = candidates.find(
    (item) => typeof item === "string" || typeof item === "number",
  );

  if (value !== undefined && value !== null) return String(value);

  if (log.entity_type === "team_member") {
    const roleAfter = log.changes.after;
    const roleBefore = log.changes.before;
    if (typeof roleAfter === "string" || typeof roleBefore === "string") {
      return `${roleBefore ?? ""} → ${roleAfter ?? ""}`;
    }
  }

  return entityLabels[log.entity_type] ?? log.entity_type;
}

export function AuditPage() {
  const { activeCompany, activeRole } = useCompany();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const canViewAudit = activeRole === "owner" || activeRole === "admin";

  async function load() {
    if (!supabase || !activeCompany || !canViewAudit) return;

    setLoading(true);
    setError("");

    const [logsResult, teamResult] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("id, actor_id, action, entity_type, entity_id, changes, created_at")
        .eq("company_id", activeCompany.id)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.rpc("list_company_team", {
        p_company_id: activeCompany.id,
      }),
    ]);

    if (logsResult.error || teamResult.error) {
      setError(
        logsResult.error?.message ||
          teamResult.error?.message ||
          "Não foi possível carregar a auditoria.",
      );
    } else {
      setLogs((logsResult.data ?? []) as AuditLog[]);
      setMembers((teamResult.data ?? []) as TeamMember[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id, activeRole]);

  const actorNames = useMemo(
    () =>
      new Map(
        members.map((member) => [
          member.user_id,
          member.full_name || member.email || "Usuário",
        ]),
      ),
    [members],
  );

  const entities = useMemo(
    () => Array.from(new Set(logs.map((log) => log.entity_type))).sort(),
    [logs],
  );

  const actions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action))).sort(),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");

    return logs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (entityFilter && log.entity_type !== entityFilter) return false;

      if (!normalized) return true;

      const actor = log.actor_id ? actorNames.get(log.actor_id) ?? "" : "Sistema";
      const entity = entityLabels[log.entity_type] ?? log.entity_type;
      const description = describeLog(log);

      return [actor, entity, description, actionLabels[log.action] ?? log.action]
        .some((value) =>
          value.toLocaleLowerCase("pt-BR").includes(normalized),
        );
    });
  }, [logs, actionFilter, entityFilter, query, actorNames]);

  if (!canViewAudit) {
    return (
      <section className="panel empty-state">
        <strong>Área restrita.</strong>
        <span>Somente Owner e Admin podem consultar a auditoria.</span>
      </section>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">SEGURANÇA</p>
          <h1>Auditoria</h1>
          <p>Veja quem alterou o quê e quando dentro da empresa.</p>
        </div>
      </header>

      <section className="panel audit-filters">
        <input
          className="table-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar usuário, ação ou registro..."
        />

        <select
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
        >
          <option value="">Todas as ações</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {actionLabels[action] ?? action}
            </option>
          ))}
        </select>

        <select
          value={entityFilter}
          onChange={(event) => setEntityFilter(event.target.value)}
        >
          <option value="">Todos os módulos</option>
          {entities.map((entity) => (
            <option key={entity} value={entity}>
              {entityLabels[entity] ?? entity}
            </option>
          ))}
        </select>

        <button className="ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </section>

      {error && <div className="form-alert error page-alert">{error}</div>}

      <section className="panel table-panel">
        <div className="panel-title report-panel-title">
          <div>
            <h2>Histórico de atividades</h2>
            <p>Os 300 eventos mais recentes da empresa</p>
          </div>
          <span className="report-count">{filteredLogs.length} evento(s)</span>
        </div>

        {loading ? (
          <div className="empty-state">Carregando auditoria...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhum evento encontrado.</strong>
            <span>Novas ações realizadas após a v0.7.0 aparecerão aqui.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Usuário</th>
                  <th>Ação</th>
                  <th>Módulo</th>
                  <th>Registro</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <strong>
                        {new Date(log.created_at).toLocaleDateString("pt-BR")}
                      </strong>
                      <small className="cell-subtitle">
                        {new Date(log.created_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </td>
                    <td>
                      {log.actor_id
                        ? actorNames.get(log.actor_id) ?? "Usuário removido"
                        : "Sistema"}
                    </td>
                    <td>
                      <span className={"audit-action " + log.action}>
                        {actionLabels[log.action] ?? log.action}
                      </span>
                    </td>
                    <td>{entityLabels[log.entity_type] ?? log.entity_type}</td>
                    <td>
                      <strong>{describeLog(log)}</strong>
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
