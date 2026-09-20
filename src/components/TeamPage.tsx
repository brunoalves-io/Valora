
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

type TeamRole = "owner" | "admin" | "member" | "viewer";

type TeamMember = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: TeamRole;
  joined_at: string;
};

type Invitation = {
  id: string;
  email: string;
  role: Exclude<TeamRole, "owner">;
  status: "pending" | "accepted" | "cancelled";
  created_at: string;
};

const roleLabels: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Membro",
  viewer: "Visualizador",
};

const roleDescriptions: Record<TeamRole, string> = {
  owner: "Controle total da empresa e da equipe.",
  admin: "Gerencia a operação e membros comuns.",
  member: "Pode trabalhar no financeiro, sem administrar a equipe.",
  viewer: "Acesso somente para consulta.",
};

export function TeamPage() {
  const { user } = useAuth();
  const { activeCompany, activeRole, refreshCompanies } = useCompany();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<TeamRole, "owner">>("member");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManageTeam = activeRole === "owner" || activeRole === "admin";
  const canManageAdmins = activeRole === "owner";

  async function load() {
    if (!supabase || !activeCompany || !canManageTeam) return;

    setLoading(true);
    setError("");

    const [teamResult, invitationResult] = await Promise.all([
      supabase.rpc("list_company_team", {
        p_company_id: activeCompany.id,
      }),
      supabase
        .from("team_invitations")
        .select("id, email, role, status, created_at")
        .eq("company_id", activeCompany.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    if (teamResult.error || invitationResult.error) {
      setError(
        teamResult.error?.message ||
          invitationResult.error?.message ||
          "Não foi possível carregar a equipe.",
      );
    } else {
      setMembers((teamResult.data ?? []) as TeamMember[]);
      setInvitations((invitationResult.data ?? []) as Invitation[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [activeCompany?.id, activeRole]);

  const totals = useMemo(
    () => ({
      total: members.length,
      admins: members.filter((member) =>
        member.role === "owner" || member.role === "admin"
      ).length,
      viewers: members.filter((member) => member.role === "viewer").length,
    }),
    [members],
  );

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !activeCompany) return;

    setBusy(true);
    setError("");
    setSuccess("");

    const { error: rpcError } = await supabase.rpc("invite_company_member", {
      p_company_id: activeCompany.id,
      p_email: email.trim(),
      p_role: role,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    setEmail("");
    setRole("member");
    setSuccess(
      "Convite registrado. Quando essa pessoa entrar no Valora com este mesmo e-mail, o acesso será liberado automaticamente.",
    );
    setBusy(false);
    await load();
  }

  async function updateRole(member: TeamMember, nextRole: Exclude<TeamRole, "owner">) {
    if (!supabase || !activeCompany || member.role === nextRole) return;

    setError("");
    setSuccess("");

    const { error: rpcError } = await supabase.rpc("update_company_member_role", {
      p_company_id: activeCompany.id,
      p_user_id: member.user_id,
      p_role: nextRole,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setSuccess("Permissão atualizada.");
    await load();
    if (member.user_id === user?.id) await refreshCompanies();
  }

  async function removeMember(member: TeamMember) {
    if (!supabase || !activeCompany) return;
    if (!window.confirm(`Remover ${member.full_name || member.email || "este usuário"} da empresa?`)) {
      return;
    }

    setError("");
    setSuccess("");

    const { error: rpcError } = await supabase.rpc("remove_company_member", {
      p_company_id: activeCompany.id,
      p_user_id: member.user_id,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setSuccess("Acesso removido.");
    await load();
  }

  async function cancelInvitation(invitation: Invitation) {
    if (!supabase) return;

    setError("");
    setSuccess("");

    const { error: rpcError } = await supabase.rpc("cancel_company_invitation", {
      p_invitation_id: invitation.id,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setSuccess("Convite cancelado.");
    await load();
  }

  if (!canManageTeam) {
    return (
      <section className="panel empty-state">
        <strong>Área restrita.</strong>
        <span>Somente Owner e Admin podem gerenciar a equipe.</span>
      </section>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMINISTRAÇÃO</p>
          <h1>Equipe</h1>
          <p>Convide pessoas e controle o nível de acesso de cada usuário.</p>
        </div>
      </header>

      <section className="compact-metrics">
        <article className="metric-card">
          <span>Usuários</span>
          <strong>{totals.total}</strong>
          <small>Membros com acesso</small>
        </article>
        <article className="metric-card">
          <span>Gestores</span>
          <strong>{totals.admins}</strong>
          <small>Owner + Admin</small>
        </article>
        <article className="metric-card">
          <span>Visualizadores</span>
          <strong>{totals.viewers}</strong>
          <small>Acesso somente leitura</small>
        </article>
      </section>

      <form className="panel team-invite-form" onSubmit={invite}>
        <div className="form-heading">
          <div>
            <h2>Convidar usuário</h2>
            <p>
              O convite fica pendente até a pessoa entrar no Valora usando exatamente este e-mail.
            </p>
          </div>
        </div>

        <div className="team-invite-grid">
          <label className="wide">
            E-mail
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="pessoa@empresa.com"
              required
            />
          </label>

          <label>
            Papel
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as Exclude<TeamRole, "owner">)
              }
            >
              {canManageAdmins && <option value="admin">Admin</option>}
              <option value="member">Membro</option>
              <option value="viewer">Visualizador</option>
            </select>
          </label>

          <button className="primary team-invite-button" disabled={busy}>
            {busy ? "Convidando..." : "Criar convite"}
          </button>
        </div>

        <div className="role-help-grid">
          {(["admin", "member", "viewer"] as TeamRole[])
            .filter((item) => item !== "admin" || canManageAdmins)
            .map((item) => (
              <div key={item}>
                <strong>{roleLabels[item]}</strong>
                <span>{roleDescriptions[item]}</span>
              </div>
            ))}
        </div>
      </form>

      {error && <div className="form-alert error page-alert">{error}</div>}
      {success && <div className="form-alert success page-alert">{success}</div>}

      <section className="panel table-panel team-table-panel">
        <div className="panel-title report-panel-title">
          <div>
            <h2>Membros</h2>
            <p>Quem já possui acesso à empresa</p>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Carregando equipe...</div>
        ) : (
          <div className="table-scroll">
            <table className="team-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Papel</th>
                  <th>Entrou em</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.user_id === user?.id;
                  const canEditMember =
                    member.role !== "owner" &&
                    (activeRole === "owner" || member.role !== "admin");

                  return (
                    <tr key={member.user_id}>
                      <td>
                        <div className="team-person">
                          <div className="team-avatar">
                            {(member.full_name || member.email || "U").slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <strong>
                              {member.full_name || member.email || "Usuário"}
                              {isSelf && <span className="self-badge">Você</span>}
                            </strong>
                            <small>{member.email || "E-mail indisponível"}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {member.role === "owner" || !canEditMember ? (
                          <span className={"team-role " + member.role}>
                            {roleLabels[member.role]}
                          </span>
                        ) : (
                          <select
                            className="team-role-select"
                            value={member.role}
                            onChange={(event) =>
                              void updateRole(
                                member,
                                event.target.value as Exclude<TeamRole, "owner">,
                              )
                            }
                          >
                            {canManageAdmins && <option value="admin">Admin</option>}
                            <option value="member">Membro</option>
                            <option value="viewer">Visualizador</option>
                          </select>
                        )}
                      </td>
                      <td>
                        {new Date(member.joined_at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="right">
                        {canEditMember && !isSelf && (
                          <button
                            className="table-action danger-action"
                            onClick={() => void removeMember(member)}
                          >
                            Remover
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel table-panel team-invitations-panel">
        <div className="panel-title report-panel-title">
          <div>
            <h2>Convites pendentes</h2>
            <p>Aguardando o primeiro acesso do convidado</p>
          </div>
        </div>

        {invitations.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhum convite pendente.</strong>
            <span>Novos convites aparecerão aqui.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>Criado em</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const canCancel =
                    activeRole === "owner" || invitation.role !== "admin";

                  return (
                    <tr key={invitation.id}>
                      <td><strong>{invitation.email}</strong></td>
                      <td>
                        <span className={"team-role " + invitation.role}>
                          {roleLabels[invitation.role]}
                        </span>
                      </td>
                      <td>
                        {new Date(invitation.created_at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="right">
                        {canCancel && (
                          <button
                            className="table-action danger-action"
                            onClick={() => void cancelInvitation(invitation)}
                          >
                            Cancelar convite
                          </button>
                        )}
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
  );
}
