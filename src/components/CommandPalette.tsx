import { useEffect, useMemo, useRef, useState } from "react";

export type CommandPaletteItem = {
  id: string;
  label: string;
  group: string;
  keywords?: string;
};

type Props = {
  open: boolean;
  items: CommandPaletteItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
};

export function CommandPalette({ open, items, onClose, onSelect }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return items;

    return items.filter((item) => {
      const haystack = `${item.label} ${item.group} ${item.keywords ?? ""}`
        .toLocaleLowerCase("pt-BR");
      return haystack.includes(normalized);
    });
  }, [items, query]);

  useEffect(() => {
    if (!open) return;

    setQuery("");
    setActiveIndex(0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) =>
      filtered.length === 0 ? 0 : Math.min(current, filtered.length - 1),
    );
  }, [filtered.length]);

  if (!open) return null;

  function choose(id: string) {
    onSelect(id);
    onClose();
  }

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) =>
              filtered.length ? (current + 1) % filtered.length : 0,
            );
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) =>
              filtered.length
                ? (current - 1 + filtered.length) % filtered.length
                : 0,
            );
          }

          if (event.key === "Enter" && filtered[activeIndex]) {
            event.preventDefault();
            choose(filtered[activeIndex].id);
          }
        }}
      >
        <header className="command-palette-header">
          <div className="command-palette-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="m16.5 16.5 4 4" />
            </svg>
          </div>
          <div className="command-palette-input-wrap">
            <label id="command-palette-title" htmlFor="command-palette-input">
              Ir para
            </label>
            <input
              ref={inputRef}
              id="command-palette-input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              placeholder="Busque por lançamentos, relatórios, clientes..."
              autoComplete="off"
            />
          </div>
          <kbd>ESC</kbd>
        </header>

        <div className="command-palette-results" role="listbox">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">
              <strong>Nenhum módulo encontrado</strong>
              <span>Tente outro termo, como “caixa”, “banco” ou “relatório”.</span>
            </div>
          ) : (
            filtered.map((item, index) => {
              const showGroup =
                index === 0 || filtered[index - 1]?.group !== item.group;

              return (
                <div className="command-palette-result-group" key={item.id}>
                  {showGroup && (
                    <span className="command-palette-group-label">
                      {item.group}
                    </span>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={
                      index === activeIndex
                        ? "command-palette-item active"
                        : "command-palette-item"
                    }
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item.id)}
                  >
                    <span>{item.label}</span>
                    <small>Enter ↵</small>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <footer className="command-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> fechar</span>
        </footer>
      </section>
    </div>
  );
}
