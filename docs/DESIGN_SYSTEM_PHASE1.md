# Valora — Design System, Fase 1

Esta etapa estabelece a base visual e refina a estrutura da navegação. Aplica os
princípios de clareza, hierarquia e consistência da Apple HIG, previsibilidade de
Nielsen e tipografia, foco e geometria adequados ao Windows 11.

## Escopo e preservação

- Logo e arquivos de marca intactos.
- Verde da marca `#49c390`, verde de ação `#269b72`, hover `#208761` e azul escuro
  `#101a2b` preservados. Texto preto nos botões verdes alcança contraste mínimo de
  4,5:1 tanto no estado normal quanto no hover.
- Nenhuma alteração nos contextos, cliente Supabase, queries, RPCs, autenticação,
  permissões, cálculos, Edge Functions, banco de dados ou comandos Tauri.
- Nenhuma nova ação de negócio, reorganização de módulos ou alteração de fluxos.
- Não inclui redesign individual de páginas, tratamento de rascunhos, paginação,
  gerenciamento de foco dos diálogos ou outras fases da auditoria.

## Organização dos estilos

`src/main.tsx` importa, nesta ordem:

1. `styles.css`: estilos existentes e componentes especializados.
2. `styles/design-system.css`: tokens e primitivas compartilhadas.
3. `styles/navigation.css`: barra lateral e estrutura da área de trabalho.

A camada de compatibilidade mantém as classes existentes (`primary`, `ghost`,
`panel`, `metric-card`, `table-action` etc.). Evita trocar componentes de negócio
durante esta etapa. A migração dos estilos especializados e remoção das regras
antigas devem acontecer incrementalmente em fases posteriores.

O novo contêiner `.workspace-content` limita apenas o conteúdo da página. Os
backdrops fixos dos diálogos deixam de herdar o limite de largura do conteúdo.

## Tokens e decisões

| Família | Padrão |
| --- | --- |
| Fonte | Segoe UI Variable / Segoe UI no Windows; sistema Apple como fallback |
| Texto | 14 px de corpo, 13 px de apoio, 12 px de legenda, 18 px de seção, 28–32 px de título, com medidas em `rem` |
| Pesos | 400 para leitura, 500 para ênfase moderada, 600 para títulos e ações |
| Espaçamento | 4, 8, 12, 16, 20, 24, 32, 40 e 48 px |
| Raios | 8 px em controles; 12, 16 e 20 px em superfícies |
| Controles | 44 px de altura de referência; ações de tabela com 36 px para ponteiro e 44 px para toque |
| Valores | Algarismos tabulares e proteção contra quebra em colunas monetárias |
| Foco | Contorno visível de 2 px; adaptação a cores forçadas |
| Movimento | Feedback discreto; respeito a `prefers-reduced-motion` |
| Superfícies | Fundos sólidos e sombras sutis; sem novos efeitos de vidro |

Botões de desktop usam cantos discretos em vez de reproduzir as cápsulas dos
exemplos de iOS da skill. A navegação usa SVGs existentes; o símbolo de ajuda foi
alinhado ao mesmo sistema. Não há dependência de SF Symbols no Windows.

Os tokens escuros são preparados com `data-valora-theme="dark"`, mas não há
ativação automática nem seletor novo. As páginas especializadas ainda contêm
cores literais e precisam de migração antes de habilitar o tema global.

## Adaptação da estrutura

- Acima de 1100 px: lateral de 272 px e conteúdo flexível.
- Entre 901 e 1100 px: lateral de 248 px, mantendo rótulos legíveis.
- Até 900 px: navegação compacta com nomes acessíveis, títulos e badge de alertas.
- Até 600 px de altura: rolagem da lateral inteira, evitando uma área de navegação
  interna excessivamente pequena.
- Navegação continua disponível abaixo do breakpoint antigo que a ocultava.
- Cabeçalhos quebram linhas; formulários compartilhados dimensionam colunas pelo
  espaço disponível; métricas usam duas colunas em larguras intermediárias.
- Link “Ir para o conteúdo” acessível pelo teclado.

## Validação automatizada reproduzível

O projeto não possuía testes automatizados configurados. Além de `npm run build`,
`scripts/verify-design-system.mjs` verifica a interface real em Chromium headless
com dados fictícios. O script bloqueia a rede externa e responde localmente ao
domínio reservado `valora-ui-test.invalid`. Nenhum Supabase real é consultado.

As dependências opcionais de QA podem ficar fora do projeto:

```powershell
$qaTools = Join-Path $env:TEMP 'valora-phase1-qa-tools'
npm install --prefix $qaTools --no-save --ignore-scripts --no-package-lock --no-audit --no-fund playwright-core@1.58.2 axe-core@4.11.0
$env:VALORA_QA_TOOLS = $qaTools
$env:VALORA_QA_BROWSER = 'C:\caminho\para\chrome.exe'
node scripts/verify-design-system.mjs
```

Requer as dependências normais do projeto instaladas e um Chromium disponível.
A porta local 4175 deve estar livre. Capturas e resultados são gravados em uma
pasta temporária informada ao terminar, sem gerar arquivos de QA no repositório.

Cobertura:

- 21 destinos do menu principal e acesso a Configurações preservados.
- Estrutura sem overflow horizontal da página nas nove dimensões testadas:
  1000×680, 1280×800, 1440×900, 1920×1080, 1024×640, 853×533, 640×400, 800×533
  e 960×640. Tabelas extensas mantêm sua rolagem própria.
- Rótulos de navegação e acesso ao rodapé em tamanhos compactos.
- Campos compartilhados do formulário de lançamentos com pelo menos 44 px de
  altura e 14 px de fonte; abertura e cancelamento sem gravação.
- Backdrop de confirmação cobrindo 2560×1440; saída por Escape.
- Seletor de empresa dentro dos limites da janela compacta.
- Atalhos Ctrl K, F1 e link de pular navegação.
- Axe WCAG A/AA na barra lateral fechada; não é certificação do aplicativo todo.
- Contraste dos tokens de texto, botões normais e hover; cores de marca preservadas.
- Tokens escuros no botão compartilhado e foco em cores forçadas.
- Capturas com densidades de pixels emuladas de 1, 1,25, 1,5 e 2.

## Limites da validação

Chromium headless e emulação de densidade não substituem inspeção no Tauri/
WebView2, DPI nativo do Windows, Narrador ou teste com dados reais. A validação
financeira e das integrações não faz parte deste teste visual com fixtures.

As cores, fontes e layouts locais dos componentes especializados permanecem para
as fases seguintes; não se declara conformidade WCAG completa nem tema escuro
completo. O build informa um chunk JavaScript acima de 500 kB; divisão de código
fica fora desta reformulação visual.
