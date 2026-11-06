# Iconografia e acessibilidade — Nova empresa e Conciliação bancária

Data: 6 de novembro de 2026. Branch: `ux/apple-hig-fase1`.

Aplicação da skill `apple-hig-designer` ao Design System existente, com convenções de interação do Windows. A intervenção preserva marca, logotipo, dependências, consultas, algoritmos financeiros e processos bancários. As mudanças locais das etapas anteriores foram mantidas. Sem push ou merge.

## Implementação

| Área | Refinamento visual e semântico |
| --- | --- |
| Nova empresa | Sinal textual substituído por SVG de 20 px, traço 1,8 e container de 32 px. Ícone e conjunto título/subtítulo centralizados por Grid, com gap e padding de 12 px |
| Seletor de empresas | Conteúdo apresentado como região nomeada com botões nativos, adequada à presença do formulário interno. Empresa atual indicada por `aria-current`; Escape fecha e devolve foco ao disparador. Fluxos de seleção e criação preservados |
| Conta ou caixa | SVG de instituição, container de 40 px e gráfico de 24 px. Select associado explicitamente ao título e à descrição |
| Origem dos dados | Fieldset nomeado com dois radios nativos do mesmo grupo; nomes, descrições, seleção única e desabilitação expostos à acessibilidade |
| Open Finance | Símbolo vetorial de vínculo, distinto do ícone de conta; identificação textual do feed e do vínculo |
| Importar arquivo | Documento com seta de importação em SVG; formatos e indisponibilidade descritos em texto |
| Conta vinculada | Confirmação vetorial acompanhada de texto e contagem real. Estado de consulta usa informação neutra; região de status com `aria-busy` e anúncio atômico |
| Usar movimentações | Símbolo vetorial de atualização; botão Atualizar dados de 44 px e distribuição adaptativa |
| Estado vazio | Setas de conciliação em SVG de 28 px sobre container de 48 px, com título e explicação preservados |
| Regras e Como funciona? | SVGs de 20 px com o mesmo traço, alinhados aos rótulos. Ajuda informa `aria-expanded` e controla uma seção identificada |

Os SVGs novos usam `viewBox="0 0 24 24"`, traço de 1,8 e extremidades/junções arredondadas. São decorativos: `aria-hidden="true"`, `focusable="false"`, sem títulos redundantes nem entradas independentes de foco. Não há ícones informativos independentes nesta intervenção: a informação está nos textos e estados dos controles.

O componente `InterfaceIcon` concentra adição, conta, vínculo, importação, atualização, conciliação, regras e ajuda. `StatusIcon` foi reutilizado para confirmação e informação.

## Preservação dos fluxos

Os handlers existentes de carregamento e importação continuam sendo chamados pelos controles. Radios desmarcados usam a mudança nativa; o radio já selecionado mantém a ação de atualizar/trocar arquivo por clique e Espaço. Isso evita perder uma interação que os botões anteriores ofereciam. A seleção continua refletindo a origem efetivamente determinada pelos dados existentes, sem inventar conclusão de carregamento.

Durante a consulta da conta, as ações de origem ficam temporariamente indisponíveis para evitar usar um vínculo anterior. A região de status informa carregamento, quantidade e formato somente a partir do estado real; erros existentes usam `role="alert"`. Nenhum algoritmo de correspondência, sincronização, confirmação financeira ou chamada ao Supabase foi reescrito.

## Arquivos desta etapa

- `src/components/InterfaceIcon.tsx`: vetores decorativos reutilizáveis.
- `src/App.tsx`: ícone Nova empresa, indicação da empresa atual, semântica e Escape do seletor.
- `src/components/BankReconciliationPage.tsx`: ícones, rótulos acessíveis, radios e feedback de estado.
- `src/styles/refinement.css`: geometria, contraste, foco, alvos e adaptação das áreas modificadas.
- `scripts/verify-icon-accessibility.mjs`: testes específicos com fixtures isoladas.
- `scripts/verify-refinement.mjs`: integração com a regressão existente e cache temporário do Vite.
- `docs/ICONOGRAPHY_ACCESSIBILITY_AUDIT.md` e `docs/UX_REFINEMENT_AUDIT.md`: registro dos resultados.

## Validações executadas

Os testes usam Chromium headless e respostas fictícias, com a rede externa bloqueada. Não consultam dados bancários reais e não confirmam movimentações financeiras.

### Testes automatizados específicos

- Centro do SVG e centro do conjunto título/subtítulo de Nova empresa com diferença inferior a 1 px em quatro dimensões.
- Tab e Shift+Tab até a ação Nova empresa; Enter e Espaço abrem o formulário; Escape cancela e/ou fecha o seletor com restauração de foco.
- Conta com vínculo e conta sem vínculo: nome acessível, disponibilidade e estado dos radios verificados.
- Radios nativos sem `aria-pressed`; seleção única e descrição da indisponibilidade verificadas.
- Espaço carrega o feed fictício uma vez; Espaço abre o seletor de arquivo; CSV fictício ativa a origem arquivo; seta para a esquerda retorna ao Open Finance.
- Regras abre pelo teclado; Escape fecha e restaura foco. Como funciona? alterna por Enter/Espaço e expõe o estado expandido.
- Erro fictício de leitura aparece em região de alerta; não se anuncia uma conciliação como concluída.
- SVGs novos decorativos, sem foco e com viewBox padronizado verificados.
- Alvos testados com pelo menos 44×44 px; radios de 24 px contidos em labels clicáveis com área maior.
- Nove viewports: 1920×1080, 3440×1440, 2560×1440, 1366×768, 1536×864, 1280×720, 911×512, 960×540 e 480×270.
- 960×540 e 480×270 verificam reflow equivalente a 200% e 400% de zoom em Full HD. Não são testes do controle de zoom nativo do navegador ou da escala real do Windows.
- O teste completo também mantém a cobertura anterior de 21 destinos e das dimensões equivalentes às escalas de 100%, 125% e 150%.

### Contrastes medidos

Medição de estilos computados, incluindo composição de fundos translúcidos. Os gráficos são medidos pelos SVGs efetivos, não apenas pela cor declarada do container.

| Combinação | Contraste observado |
| --- | --- |
| Adição de Nova empresa sobre seu container verde escuro | 7,51:1 |
| Ícones neutros da conta e importação | Pelo menos 6,03:1 |
| Status neutro sem vínculo | 5,59:1 |
| Confirmação de vínculo | Pelo menos 5,73:1 |
| Atualização e estado vazio | Pelo menos 6,13:1 |
| Ícones dos botões Regras/Como funciona? | 6,31:1 |
| Borda neutra da opção de origem | 3,25:1 |
| Borda selecionada e indicador de radio | Pelo menos 6,13:1 |
| Descrições das opções de origem | Pelo menos 5,73:1 |

Os elementos essenciais medidos superam 3:1; os textos medidos superam 4,5:1. O foco visível é testado por sua espessura mínima e contraste, sem exigir uma espessura exata de implementação. Isso não representa auditoria de todas as cores do aplicativo.

### Resultado final da regressão

`node scripts/verify-refinement.mjs` passou na execução completa, incluindo os testes anteriores e os novos cenários. Nenhum erro JavaScript foi capturado e nenhum host externo foi acessado. `git diff --check` passou. Os testes focados também passaram separadamente.

Evidências finais: `%TEMP%\valora-phase1-qa-1MSyTH`. A pasta contém `verification-results.json`, `icons-accessibility-tree.txt`, capturas `icons-company-*`, `icons-reconciliation-empty.png` e `icons-reconciliation-*`. Foram inspecionadas visualmente capturas de Nova empresa e conciliação em Full HD, Ultrawide e janela de reflow equivalente a 400%. Os testes de teclado descritos foram executados por automação; não foram testes manuais com um leitor de tela.

### Compilação

O comando padrão inicialmente falhou com `TS5033 / ENOENT`. A investigação confirmou bloqueios do Acesso Controlado a Pastas do Defender, registrados no evento 1123. Na validação posterior de 6 de novembro de 2026, a gravação já estava disponível; o comando **`npm.cmd run build` passou integralmente na pasta original**, fora do sandbox com autorização, sem alterações no script ou nas configurações. A tentativa dentro do sandbox apresentou uma restrição distinta de leitura do esbuild. Evidências, configuração verificada e procedimento de execução: [BUILD_WINDOWS_DIAGNOSIS.md](BUILD_WINDOWS_DIAGNOSIS.md).

Foram executadas com sucesso as verificações sem emissão de arquivos:

```powershell
# PowerShell · verificação TypeScript · Windows · Node/TypeScript
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit --incremental false --composite false
```

O build de produção do Vite passou com `--configLoader runner` e `--outDir` temporário, preservando as configurações versionadas. Artefatos finais: `%TEMP%\valora-icon-build-a06c13c6724d44d48b20219d38bab6ac`. Foram transformados 124 módulos; CSS 267,52 kB (46,71 kB gzip) e JavaScript 1.226,55 kB (356,44 kB gzip). O aviso de chunk JavaScript acima de 500 kB permanece.

**Atualização da investigação do build:** o comando padrão passou posteriormente na pasta original, com geração de `dist`, sem essas flags alternativas. A suíte completa também passou novamente; evidências em `%TEMP%\valora-phase1-qa-VIUaup\verification-results.json`. O diagnóstico atualizado distingue o bloqueio histórico do Defender da restrição de leitura do sandbox.

## Limites e aceite

A árvore de acessibilidade do Chromium foi inspecionada por automação. Não foi executado teste com Narrador ou NVDA no Tauri/WebView2; não se declara compatibilidade validada com esses leitores. A ferramenta axe não estava instalada no conjunto local de QA utilizado, portanto não foi executada uma auditoria axe. As verificações automatizadas de nomes, papéis, foco e contraste são específicas aos cenários descritos.

Escalas reais do Windows, zoom nativo, interpretação por leitores de tela e fluxos com dados reais continuam como validações de homologação. As tabelas financeiras extensas preservam a rolagem horizontal própria em telas estreitas. Não se declara conformidade integral WCAG 2.2 AA.

O resultado visual segue submetido à avaliação do usuário.
