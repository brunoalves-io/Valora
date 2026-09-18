const nav = [
  ["⌂", "Início"],
  ["$", "Financeiro"],
  ["↔", "Lançamentos"],
  ["↓", "Contas a pagar"],
  ["↑", "Contas a receber"],
  ["◉", "Contas e caixas"],
  ["▣", "Cartões"],
  ["♙", "Clientes"],
  ["♟", "Fornecedores"],
  ["◇", "Propostas"],
  ["▥", "Relatórios"],
  ["✦", "Valora IA"],
];

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{money.format(value)}</strong>
      <small>{detail}</small>
    </article>
  );
}

export default function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>Valora</strong>
            <span>Gestão inteligente</span>
          </div>
        </div>

        <nav>
          {nav.map(([icon, label], index) => (
            <button className={index === 0 ? "nav-item active" : "nav-item"} key={label}>
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <button className="settings">⚙ Configurações</button>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">VISÃO GERAL</p>
            <h1>Bom dia 👋</h1>
            <p>Veja como está a saúde financeira da sua empresa.</p>
          </div>
          <div className="top-actions">
            <button className="ghost">🔔</button>
            <button className="primary">+ Novo lançamento</button>
          </div>
        </header>

        <section className="metrics">
          <Metric label="Saldo atual" value={48250} detail="+8,2% no mês" />
          <Metric label="A receber" value={32800} detail="12 lançamentos" />
          <Metric label="A pagar" value={18450} detail="9 lançamentos" />
          <Metric label="Resultado do mês" value={14350} detail="Receitas − despesas" />
        </section>

        <section className="grid">
          <article className="panel chart-panel">
            <div className="panel-title">
              <div>
                <h2>Fluxo de caixa</h2>
                <p>Últimos 6 meses</p>
              </div>
              <button className="ghost text">Ver relatório</button>
            </div>
            <div className="chart">
              {[34, 46, 38, 61, 53, 72].map((height, i) => (
                <div className="bar-wrap" key={i}>
                  <div className="bar" style={{ height: `${height}%` }} />
                  <span>{["Abr", "Mai", "Jun", "Jul", "Ago", "Set"][i]}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-title">
              <div>
                <h2>Próximos vencimentos</h2>
                <p>Contas que merecem atenção</p>
              </div>
            </div>
            <div className="due-list">
              {[
                ["Energia", "Hoje", 820, "danger"],
                ["Fornecedor XYZ", "20/09", 3500, "warning"],
                ["Internet", "22/09", 199, "neutral"],
                ["Software", "27/09", 159, "neutral"],
              ].map(([name, date, value, tone]) => (
                <div className="due-row" key={String(name)}>
                  <span className={`status-dot ${tone}`} />
                  <div>
                    <strong>{name}</strong>
                    <small>{date}</small>
                  </div>
                  <b>{money.format(Number(value))}</b>
                </div>
              ))}
            </div>
          </article>

          <article className="panel summary">
            <div className="panel-title">
              <div>
                <h2>Receitas x despesas</h2>
                <p>Setembro de 2026</p>
              </div>
            </div>
            <div className="summary-row">
              <span>Receitas</span><strong>{money.format(52800)}</strong>
            </div>
            <div className="progress"><i style={{ width: "78%" }} /></div>
            <div className="summary-row">
              <span>Despesas</span><strong>{money.format(38450)}</strong>
            </div>
            <div className="progress muted"><i style={{ width: "57%" }} /></div>
            <div className="result-line">
              <span>Resultado</span><strong>{money.format(14350)}</strong>
            </div>
          </article>

          <article className="panel ai-panel">
            <div className="ai-icon">✦</div>
            <div>
              <h2>Valora IA</h2>
              <p>Pergunte sobre suas finanças em linguagem natural.</p>
            </div>
            <div className="ask">
              <input placeholder='Ex.: "Quanto tenho para pagar nos próximos 7 dias?"' />
              <button>Enviar</button>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
