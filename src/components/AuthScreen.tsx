import { useState, type FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (mode === "login") {
        await signIn(email.trim(), password);
      } else {
        const needsConfirmation = await signUp(name.trim(), email.trim(), password);
        if (needsConfirmation) {
          setMessage("Conta criada. Confira seu e-mail para confirmar o cadastro.");
          setMode("login");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="brand large">
          <div className="brand-mark">V</div>
          <div>
            <strong>Valora</strong>
            <span>Gestão inteligente</span>
          </div>
        </div>
        <div className="auth-copy">
          <p className="eyebrow">FINANÇAS SEM NEBLINA</p>
          <h1>Veja o negócio inteiro sem caçar números em planilhas.</h1>
          <p>
            Fluxo de caixa, contas a pagar e receber, clientes, relatórios e
            inteligência financeira em um só lugar.
          </p>
        </div>
      </section>

      <section className="auth-card-wrap">
        <form className="auth-card" onSubmit={submit}>
          <div>
            <p className="eyebrow">{mode === "login" ? "BEM-VINDO" : "COMECE AGORA"}</p>
            <h2>{mode === "login" ? "Entrar no Valora" : "Criar sua conta"}</h2>
            <p>
              {mode === "login"
                ? "Acesse sua empresa e continue de onde parou."
                : "Crie sua conta para configurar a primeira empresa."}
            </p>
          </div>

          {mode === "signup" && (
            <label>
              Seu nome
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nome completo"
                autoComplete="name"
                required
              />
            </label>
          )}

          <label>
            E-mail
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="voce@empresa.com"
              autoComplete="email"
              required
            />
          </label>

          <label>
            Senha
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="Mínimo de 6 caracteres"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              required
            />
          </label>

          {error && <div className="form-alert error">{error}</div>}
          {message && <div className="form-alert success">{message}</div>}

          <button className="primary auth-submit" disabled={busy}>
            {busy ? "Processando..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError("");
              setMessage("");
            }}
          >
            {mode === "login"
              ? "Ainda não tenho conta"
              : "Já tenho uma conta"}
          </button>
        </form>
      </section>
    </div>
  );
}
