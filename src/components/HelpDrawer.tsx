import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function HelpDrawer({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousActive = document.activeElement as HTMLElement | null;
    window.setTimeout(() => closeRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousActive?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="help-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-drawer-title"
      >
        <header className="help-drawer-header">
          <div>
            <span>AJUDA RÁPIDA</span>
            <h2 id="help-drawer-title">Como se orientar no Valora</h2>
            <p>Atalhos e referências para concluir tarefas sem precisar decorar caminhos.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="help-drawer-close"
            onClick={onClose}
            aria-label="Fechar ajuda"
          >
            ×
          </button>
        </header>

        <div className="help-drawer-body">
          <section className="help-section">
            <h3>Navegação</h3>
            <div className="help-shortcut-row">
              <div>
                <strong>Buscar qualquer módulo</strong>
                <span>Digite o nome da área que deseja abrir.</span>
              </div>
              <kbd>Ctrl K</kbd>
            </div>
            <div className="help-shortcut-row">
              <div>
                <strong>Fechar janelas e caixas de diálogo</strong>
                <span>Use a saída rápida quando quiser cancelar uma ação.</span>
              </div>
              <kbd>Esc</kbd>
            </div>
          </section>

          <section className="help-section">
            <h3>Fluxo financeiro</h3>
            <div className="help-reference-grid">
              <article>
                <strong>Lançamentos</strong>
                <span>Registre receitas e despesas, organize categorias, contas e tags.</span>
              </article>
              <article>
                <strong>Contas a pagar / receber</strong>
                <span>Acompanhe obrigações pendentes, vencidas e concluídas.</span>
              </article>
              <article>
                <strong>Conciliação bancária</strong>
                <span>Compare o extrato com os registros do Valora antes de confirmar vínculos.</span>
              </article>
              <article>
                <strong>Planejamento</strong>
                <span>Defina orçamentos e metas para acompanhar o mês antes do fechamento.</span>
              </article>
              <article>
                <strong>Fechamento mensal</strong>
                <span>Registre um snapshot gerencial de meses concluídos e compare performance.</span>
              </article>
              <article>
                <strong>Valora IA</strong>
                <span>Consulte os dados e prepare ações, sempre revisando antes de confirmar.</span>
              </article>
            </div>
          </section>

          <section className="help-section help-status-guide">
            <h3>Como ler os estados</h3>
            <div><i className="success" /><span><strong>Verde</strong> indica concluído, saudável ou dentro do plano.</span></div>
            <div><i className="warning" /><span><strong>Âmbar</strong> indica atenção ou algo próximo de um limite.</span></div>
            <div><i className="danger" /><span><strong>Vermelho</strong> indica atraso, falha ou situação crítica.</span></div>
          </section>
        </div>

        <footer className="help-drawer-footer">
          <span>O Valora prioriza confirmação antes de ações com impacto financeiro.</span>
          <button type="button" className="ghost" onClick={onClose}>Entendi</button>
        </footer>
      </aside>
    </div>
  );
}
