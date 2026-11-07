# Conciliação bancária — refinamento e validação

7 de novembro de 2026. Branch: `chore/prepare-v1.0.41`.
Aplicada a skill `apple-hig-designer`, com os tokens do Valora e convenções Windows.
Alterações anteriores de Conexões bancárias e ConfirmDialog preservadas.

## Organização e mensagens

O painel mantém conta e origem em duas áreas, agora com alinhamento dos títulos,
controles de pelo menos 44 px e marcadores discretos das quatro etapas. O separador
“OU” foi removido; radios nativos e seus handlers foram preservados. Ação de
carregamento e vínculo usam superfícies neutras, evitando repetição de verde.
O painel de preparação tem limite de 1800 px; abaixo de 1200 px as áreas empilham,
e abaixo de 760 px as duas origens também empilham. Tabelas mantêm seu espaço próprio.

A orientação inferior é derivada dos estados existentes, sem consultas adicionais:
nenhuma conta, vínculo em verificação, arquivo aguardando seleção, Open Finance
disponível sem leitura, carregamento, leitura vazia, erro e dados prontos. Um vínculo
não é apresentado como leitura concluída. O estado vazio conhecido do feed é mostrado
como orientação neutra; falhas reais continuam em alertas. Com dados, a orientação
cede lugar à análise. Anúncios duplicados de carregamento foram reduzidos.

`activeSource` e a lógica operacional permanecem iguais. A comparação do corpo do
componente com HEAD confirmou preservação de consultas, importadores, handlers,
matching, automação, permissões, cálculos e gravações, descontando apenas a derivação
de apresentação e a extração de uma mensagem idêntica para uma constante compartilhada.
Nenhuma dependência foi adicionada.

## Resultados executados

- `npm.cmd run build`: aprovado; TypeScript e Vite, 125 módulos.
- `node scripts/test-reconciliation-guidance.mjs`: 11 cenários aprovados.
- `node scripts/verify-refinement.mjs`: aprovado na execução final; nenhum erro
  JavaScript capturado, nenhum host externo acessado, apenas fixtures.
- Estados em navegador: sem conta, conta sem vínculo, vínculo antes da leitura,
  carregamento com botão desabilitado, CSV importado, dados prontos, erro e feed vazio.
  Space/ArrowLeft, seletor, Regras, Como funciona, foco e ausência de leitura duplicada
  verificados. Nenhuma confirmação/gravação financeira real foi executada.
- 14 viewports: 1920×1080, 3440×1440, 1440×900, 1280×800, 1000×680 (mínimo Tauri),
  1536×864, 1280×720, 960×540, 2752×1152, 2293×960, 1720×720, 800×500, 640×400,
  480×270. Sem overflow horizontal da página; radios, seletores e botões com alvos
  de pelo menos 44 px. Inclui reflow equivalente às escalas solicitadas.
- Contrastes amostrados: descrições ≥6,03:1; ícones essenciais ≥6,03:1;
  bordas das opções ≥3,25:1; foco das opções ≥12,02:1.
- Capturas Full HD, ultrawide, janela reduzida e estado vazio inspecionadas.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`: três testes aprovados.
- `node scripts/verify-confirm-dialog.mjs`: aprovado, duas variantes em cinco tamanhos.
- `git diff --check` e sintaxe dos scripts alterados: aprovados.

Evidências da suíte completa: `%TEMP%\valora-phase1-qa-Wa6oR7`.
Antes da execução final, duas tentativas falharam na medição imediata da lateral
(272 px antes do commit React, esperado 76 px). O teste agora aguarda a classe de
recolhimento e a largura real antes de medir; nenhuma expectativa foi flexibilizada.

## Limitações

Chromium com fixtures e reflow equivalente não substitui zoom/DPI manual no WebView2,
Narrador/NVDA ou operações bancárias reais. Axe não foi executado; não se declara
conformidade WCAG integral. Tokens escuros existentes são reutilizados sem habilitar
modo escuro global. Permanece o aviso de bundle JavaScript acima de 500 kB.
Sem push, merge, publicação de PR ou release nesta etapa.
