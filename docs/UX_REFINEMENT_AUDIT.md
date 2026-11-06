# Valora — auditoria e refinamento de UX/UI

Data: 5 de novembro de 2026. Implementação submetida à avaliação do usuário; aprovação visual definitiva pendente.

## Diagnóstico e decisões

A base encontrada já tinha alterações locais em `App.tsx`, `main.tsx`, ícones e uma primeira fase de design system ainda não versionada. Elas foram preservadas. O trabalho continuou na branch dedicada existente `ux/apple-hig-fase1`. Não houve push ou merge.

A skill `apple-hig-designer` foi lida e aplicada com adaptação ao desktop Windows: Segoe UI no Windows, fontes de sistema como fallback, marca verde/azul preservada, superfícies sólidas, foco explícito, hierarquia e espaçamentos consistentes. Não se adicionaram fontes ou bibliotecas à aplicação.

| Prioridade | Problema encontrado | Implementação |
| --- | --- | --- |
| Alta | Container limitado a 1560 px em ultrawide | Limite de 2560 px e dashboard em três colunas acima de 2400 px; cards de cadastros distribuídos por largura mínima |
| Alta | Textos especializados entre 7 e 11 px | Escala de 12/13/14 px para legendas, apoio e corpo nos componentes refinados |
| Alta | IA com altura mínima de 610 px e textarea genérica de 96 px | Altura baseada no viewport, conversa com rolagem própria, compositor de 64–120 px e distribuição vertical em janelas estreitas |
| Alta | Diálogos sem contenção compartilhada de foco | Hook reutilizável com Tab/Shift+Tab, restauração do foco e prioridade ao modal superior |
| Alta | Textos claros e detalhes de baixa legibilidade | Tokens semânticos em badges e valores, apoio mais claro sobre o painel azul escuro e mais escuro em superfícies claras |
| Média | Estados vazios altos e tracejados | Superfícies discretas com 96–120 px de referência, podendo crescer com o conteúdo |
| Média | Ações de tabela com aparência de texto | Botões com borda, hover, foco e tratamento discreto de exclusão |
| Média | Lateral sem controle manual e rodapé rolando em baixa altura | Controle acessível de expansão/recolhimento e rolagem independente da navegação |
| Média | Gráfico de seis colunas mesmo com menos meses | Colunas conforme os meses presentes, barras proporcionais preservadas e descrição acessível dos valores |

As decisões aplicam clareza, consistência e deferência da HIG; visibilidade de estado, reconhecimento e prevenção de erros de Nielsen; e convenções de teclado e tipografia do Windows. O gráfico conserva sua escala baseada no máximo dos dados e todos os cálculos existentes.

## Cobertura implementada

| Área | Refinamento |
| --- | --- |
| Dashboard | Quatro indicadores preservados; valores tabulares; gráfico adaptativo; textos executivos e IA; estados vazios; composição ultrawide |
| Alertas | Prioridades com rótulos existentes e bordas semânticas; ações; filtros; contraste em alertas arquivados |
| Valora IA | Hierarquia do histórico, sugestões legíveis, compositor separado da rolagem, rótulo acessível, região de conversa anunciada |
| Lançamentos, pagar/receber | Tabelas e ações compartilhadas, valores alinhados, badges, filtros e estados vazios |
| Contas e caixas | Grade adaptativa, saldo negativo destacado pelo valor já calculado, ações agrupadas em uma área própria |
| Cartões e recorrências | Grades, formulários, números, ações e estados vazios compartilhados |
| Conexões bancárias | Indicadores, identificação, saldos, vinculação, privacidade e textos secundários |
| Conciliação | Opções indisponíveis, controles de origem, mensagens, estado inicial e legibilidade |
| Planejamento e fechamento | Formulários coerentes, apoio e valores legíveis, metas adaptativas, estados vazios |
| Relatórios | Filtros por espaço disponível, abas, indicadores, tabelas, legendas e cenários |
| Propostas e cadastros | Grades limitadas por largura mínima, ações explícitas, formulários e tabelas compartilhados |
| Equipe, auditoria e configurações | Campos, filtros, perfis, ações, textos de apoio e padrões compartilhados |
| Diálogos | Dimensões limitadas pelo viewport, rolagem, controles de fechamento e contenção de foco em cinco componentes |

Parte da cobertura é fornecida por seletores compartilhados; não corresponde à reescrita individual de todos os módulos.

## Componentes e arquivos desta implementação

- `src/styles/refinement.css`: camada visual de módulos e ajustes responsivos, usando os tokens existentes.
- `src/components/useDialogFocus.ts`: primitiva de foco compartilhada.
- `src/components/ConfirmDialog.tsx`: contenção de foco e efeito de teclado estável durante atualizações.
- `src/components/AITransactionDialog.tsx`, `StatementImportDialog.tsx`, `TransactionOrganizerDialog.tsx`, `CategorizationRulesDialog.tsx`: adoção da primitiva.
- `src/components/ValoraAIPage.tsx`: nome acessível do compositor e região de conversa.
- `src/components/AccountsPage.tsx`: classe semântica para saldo negativo.
- `src/components/Dashboard.tsx`: descrições acessíveis das colunas do gráfico.
- `src/App.tsx`: controle de expansão/recolhimento; alterações locais anteriores mantidas.
- `src/main.tsx`: importação da camada visual; importações locais anteriores mantidas.
- `scripts/verify-refinement.mjs`: extensão da suíte de fixtures existente `verify-design-system.mjs`.
- `docs/UX_REFINEMENT_AUDIT.md`: diagnóstico, escopo e limites.

## Validação reproduzível

`npm.cmd run build` executa TypeScript e build de produção do Vite. O projeto não define um script `test`. A suíte visual usa Playwright já disponível no ambiente, sem instalação de dependências de produção.

```powershell
# PowerShell · execução local · Windows · Node e Chromium
$env:VALORA_QA_TOOLS = 'C:\caminho\para\ferramentas-node'
$env:VALORA_QA_BROWSER = 'C:\caminho\para\chromium.exe'
node scripts/verify-refinement.mjs
```

A suíte utiliza sessão e dados fictícios, intercepta todas as requisições e bloqueia rede externa. Não acessa o Supabase real. Percorre os 21 destinos do menu com cinco tamanhos por destino (1366×768, 1920×1080, 2560×1440, 3440×1440 e 911×512). Verifica ausência de overflow da página, mantendo a rolagem própria das tabelas extensas.

Também verifica a estrutura em 13 dimensões, incluindo equivalentes arredondados às quatro resoluções em 100%, 125% e 150%; menu de empresa compacto; campos de lançamento; backdrop de confirmação; Ctrl+K; F1; link de pular navegação; foco em cores forçadas; contraste de tokens; expansão/recolhimento; e posição do compositor em 1920×1080 e 1280×720. Capturas são produzidas em pasta temporária, com JSON de resultados.

Contrastes medidos dos tokens compartilhados: botão primário 6,01:1; hover 4,70:1; texto secundário 6,31:1; legenda 5,28:1. Isso não certifica o contraste de todas as combinações de todos os módulos.

Resultado final: TypeScript e build de produção aprovados; `git diff --check` aprovado; suíte visual aprovada, sem erros JavaScript capturados e sem requisições de exclusão. O build gerou CSS de 249,97 kB e JavaScript de 1.223,49 kB antes de gzip, mantendo o aviso de chunk acima de 500 kB.

As evidências desta execução estão em `%TEMP%\valora-phase1-qa-bIKBx4`, incluindo `verification-results.json`, capturas da estrutura e capturas dos módulos em 1920 px e 911 px. Foram inspecionadas visualmente capturas de dashboard em Full HD/ultrawide, IA, lançamentos, conexões bancárias e relatórios; a passagem automatizada pelos demais destinos não equivale à inspeção manual de cada estado.

## Limitações e pendências de aceite

- Não foi executado teste nativo de Tauri/WebView2, Narrador ou escala real de exibição do Windows. Viewports equivalentes e densidade emulada são aproximações.
- As fixtures cobrem navegação, layouts e algumas interações, com dados de dashboard, conta e lançamento. Não cobrem todas as combinações de dados, tabelas cheias, erros e formulários de cada módulo.
- Não foi executada auditoria axe nesta extensão. Os testes de acessibilidade verificam interações específicas e tokens; conformidade WCAG 2.2 AA integral não é declarada.
- Tokens escuros existentes permanecem opt-in. Os módulos legados ainda possuem cores literais; modo escuro global completo não foi habilitado.
- Processos financeiros reais, geração automática, conciliação, exportação, confirmação da IA e integrações bancárias não foram executados. Os cálculos, consultas e regras correspondentes não foram modificados.
- O build informa pacote JavaScript maior que 500 kB. Recomenda-se avaliar divisão por módulo em trabalho separado.
- Não foram criados commits que incorporassem alterações preexistentes do usuário. As mudanças permanecem disponíveis para revisão na branch existente.

Antes do aceite final, recomenda-se testar no Windows/WebView2 nas três escalas com uma base de homologação representativa, além de verificar leitor de tela, zoom, mensagens de erro e os formulários preenchidos de cada módulo. A consolidação gradual dos estilos legados reduzirá a manutenção das camadas CSS.

Nenhuma migração, política RLS, autenticação, permissão, credencial, integração, serviço, regra financeira ou logotipo foi alterado por esta implementação.

## Polimento final — segunda etapa

Esta etapa preserva a base anterior e corrige detalhes remanescentes. Foi utilizada novamente a skill `apple-hig-designer`, com os tokens existentes e convenções do Windows. A aprovação visual permanece com o usuário.

### Problemas corrigidos

- **Centros de custo:** o estilo legado `.management-card .table-action` removia o padding esquerdo. As ações agora usam Flexbox para centralizar seu conteúdo e Grid de três colunas para distribuir Editar, Desativar/Reativar e Excluir. Alturas de 36 px para ponteiro e 44 px para toque, gaps de 8 px e rodapés alinhados entre cards com descrições diferentes. Em larguras inferiores a 480 px, as ações passam a uma coluna organizada.
- **Contas e caixas:** a mesma geometria dos botões foi reaproveitada; quatro ações são distribuídas em duas colunas, com rodapé ancorado à base do card.
- **Alerta executivo:** símbolo textual substituído por SVG com traço de 1,8, tamanho de 24 px e container de 40 px. Título e descrição mantidos. O componente vetorial também é reutilizado na confirmação e no status do fechamento mensal.
- **Valora IA:** painel lateral com largura mínima de 248 px no layout de duas colunas; padding de 16 px; abas de 44 px, rótulos em uma linha e estado acessível `aria-pressed`. Sugestões com altura consistente e adaptação ao conteúdo. Histórico continua com rolagem independente, assim como as mensagens. O comportamento estreito mantém a composição vertical existente.
- **Regras de categorização:** apoio em 13 px; título de 20 px; campos organizados com espaçamento de 16 px; padrão da descrição em linha completa; ação Criar regra de 44 px e 14 px de fonte. Textos, tabela e estado vazio agora usam tokens legíveis. Navegação e contenção de foco preservadas.
- **Legibilidade:** correções direcionadas em conciliação, resumo e DRE mensal, mensagens auxiliares e cartões de ações da IA. Sem aumento global indiscriminado.
- **Fechamento mensal:** estado vazio de performance deixa de esticar até a altura do card vizinho. A inspeção visual encontrou um conflito da classe genérica `.panel` que deixava branco o fundo do resumo da IA; foi restaurado o fundo azul-escuro e ajustado o contraste dos valores.
- **Dashboard:** altura útil do gráfico refinada para 224 px (256 px em Ultrawide), sem mudar dados ou fórmulas das barras. Removido truncamento desnecessário dos rótulos de resultado. Composição escura e quatro indicadores preservados.
- **Seletor de empresas:** itens com altura mínima de 56 px, avatares de 32 px, gaps uniformes e estados selecionado/hover mais claros. Rolagem da navegação com indicador discreto.

### Arquivos desta etapa

| Arquivo | Alteração |
| --- | --- |
| `src/styles/refinement.css` | Correções pontuais sobre os tokens e componentes existentes |
| `src/components/StatusIcon.tsx` | Novo SVG reutilizável para atenção, informação e confirmação |
| `src/components/Dashboard.tsx` | Adoção do ícone vetorial no banner |
| `src/components/MonthlyClosingPage.tsx` | Ícone vetorial do status mensal |
| `src/components/ConfirmDialog.tsx` | Ícone vetorial, preservando o gerenciamento de foco |
| `src/components/ValoraAIPage.tsx` | Estado acessível dos seletores Conversas/Ações IA |
| `scripts/verify-refinement.mjs` | Fixtures representativas e integração dos novos testes; modalidade de teclado estabelecida antes do teste `:focus-visible` |
| `scripts/verify-polish-checks.mjs` | Novas verificações de geometria, contraste, responsividade e foco |
| `docs/UX_REFINEMENT_AUDIT.md` | Relatório atualizado |

As alterações anteriores de outros arquivos, incluindo ícones e marca, permanecem preservadas. Nenhuma dependência foi adicionada. Não houve push, merge ou descarte de alterações locais.

### Verificações executadas e resultados

| Verificação | Resultado |
| --- | --- |
| `npm.cmd run build` (inclui `tsc -b`) | Aprovado; 123 módulos transformados |
| Build final Vite | CSS 260,75 kB / gzip 45,79 kB; JavaScript 1.224,19 kB / gzip 355,72 kB |
| `git diff --check` | Aprovado |
| `node scripts/verify-refinement.mjs` | Aprovado com rede externa bloqueada e fixtures locais |
| 21 destinos × 5 viewports | Sem overflow horizontal da página nas combinações verificadas |
| Estrutura em 13 dimensões | Inclui as quatro resoluções e equivalentes arredondados das escalas 125% e 150% |
| Centros de custo em 12 dimensões | Alturas, centralização dos textos, gaps e alinhamento entre descrições diferentes aprovados |
| Alerta crítico | SVG 24×24 centralizado em container 40×40 aprovado |
| Abas da IA em 5 dimensões | Rótulos em uma linha, contador de ação pendente, altura e seleção aprovados |
| Sugestões e compositor | Alturas das quatro sugestões e compositor visível nos tamanhos desktop verificados |
| Categorização em 4 dimensões | Modal dentro da janela, botão Criar regra alcançável e com altura mínima de 44 px |
| Foco do modal | Tab, Shift+Tab e Escape aprovados |
| Contraste auxiliar da categorização | 6,31:1 nos três elementos medidos |
| Contraste do painel mensal da IA | Entre 10,65:1 e 14,38:1 nos sete elementos medidos, com composição dos fundos translúcidos |
| Performance mensal vazia | Card abaixo de 300 px, sem esticar até a altura do vizinho |
| Console JavaScript | Nenhum erro capturado na execução final |

Os testes dos centros de custo usam descrições curtas, longas e ausentes, além de status ativo/inativo. Os testes da IA incluem ação pendente para exercitar o contador da aba. Nenhuma gravação financeira real foi realizada.

Evidências da execução final: `%TEMP%\valora-phase1-qa-iIA5jk\verification-results.json`. A mesma pasta contém capturas `polish-cost-centers-*`, `polish-critical-dashboard.png`, `polish-ai-*`, `polish-rules-*` e `polish-monthly-empty.png`. Foram inspecionadas capturas de cards, dashboard, IA, categorização em Full HD/janela pequena e fechamento mensal.

### Limitações, regressões e pendências

Não foram identificadas regressões nos cenários executados. Isso não constitui teste de todos os fluxos financeiros nem de todas as combinações de dados. O projeto continua sem script `npm test`; a suíte existente foi reutilizada pela extensão, sem executar seu trecho opcional de axe.

Permanecem necessários testes nativos de Windows/WebView2, escala real de exibição, Narrador e uma auditoria completa WCAG 2.2 AA. O modo escuro global não foi habilitado. Em viewports estreitos, histórico e conversa da IA seguem empilhados e a página pode exigir rolagem vertical. Não se declara compositor fixo à janela nesses tamanhos.

O aviso preexistente de pacote JavaScript acima de 500 kB permanece. Não houve mudança de configuração para ocultá-lo. O aceite visual final depende da avaliação do usuário.

## Iconografia e acessibilidade — 6 de novembro de 2026

O refinamento específico de Nova empresa e Conciliação bancária está documentado em [ICONOGRAPHY_ACCESSIBILITY_AUDIT.md](ICONOGRAPHY_ACCESSIBILITY_AUDIT.md), com arquivos, semântica dos radios, teclado, contrastes medidos, reflow, build e limitações do ambiente. As etapas anteriores foram preservadas.
