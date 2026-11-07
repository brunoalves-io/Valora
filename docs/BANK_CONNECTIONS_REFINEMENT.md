# Conexões bancárias — hierarquia visual

Implementado em `chore/prepare-v1.0.41`, preservando as alterações locais anteriores.
Aplicada a skill `apple-hig-designer`: clareza, agrupamento e hierarquia, mantendo
os tokens, fontes do Windows, cores e convenções de interação do Valora.

## Organização

- Instituição: logotipo/nome, status, sincronização e ações no cabeçalho; resumo
  da última leitura associado à instituição, com menor destaque.
- Contas: cards com superfície neutra, identificação, tipo, moeda e saldo;
  números tabulares e tratamento visual de saldo negativo/indisponível.
- Complementos: estado textual do vínculo, seletor e última movimentação com
  contagem do feed. Ausência de vínculo é neutra; vínculo existente usa sucesso.
- Grade por largura do painel: duas colunas a partir de 1000 px, três a partir
  de 1900 px. Em cards de até 540 px úteis, saldo abaixo da identificação.
- Controles de pelo menos 44 px, nomes acessíveis únicos, foco visível, títulos
  hierárquicos e SVGs decorativos ocultos de leitores de tela.
- Estado persistido `pending` apresentado como “Atualização pendente”; o texto
  “Sincronizando...” usa apenas o `syncingId` existente durante a operação.

## Preservação

Comparação automatizada com HEAD confirmou que o corpo operacional do componente
(antes do retorno visual), consultas, handlers, dados derivados e permissões
permaneceram idênticos. O formatador monetário também permaneceu idêntico.
Não foram alterados dados reais, Sandbox bancário, integrações ou identificadores.
Nenhuma dependência foi adicionada. Tokens escuros existentes permanecem opt-in.

## Validação executada

- `npm.cmd run build`: aprovado, incluindo TypeScript; 124 módulos Vite.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`: três testes aprovados.
- `node scripts/verify-bank-connections.mjs`: aprovado com fixtures isoladas;
  estados de saldo positivo/negativo/zero/indisponível, títulos longos, vínculos,
  desvinculação, seletor, sincronização e atualização de acesso simuladas.
- Perfil viewer: ações de sincronização ausentes e quatro seletores desabilitados.
- Contraste mínimo dos textos amostrados dos cards: 6,03:1; foco/Tab/Shift+Tab
  verificados por automação. Nenhum erro JavaScript ou host externo acessado.
- Dez dimensões: 1920×1080, 3440×1440, 1366×768, 1536×864, 1280×720, 960×540,
  2752×1152, 2293×960, 1720×720 e 480×400; sem overflow horizontal da página/cards.
  As dimensões intermediárias representam reflow equivalente a 125/150/200%.
- Capturas Full HD, ultrawide, janela pequena e tokens escuros inspecionadas.
- `verify-refinement.mjs` e `verify-confirm-dialog.mjs`: aprovados; correção
  anterior de hover do modal preservada.
- Sintaxe do novo script e `git diff --check`: aprovados.

Evidências finais da tela: `%TEMP%\valora-phase1-qa-cATIRW`.
A suíte usa as mesmas variáveis opcionais `VALORA_QA_TOOLS` e
`VALORA_QA_BROWSER` da verificação de refinamento existente.

Limites: reflow Chromium não equivale a teste manual de zoom/DPI no WebView2.
Narrador/NVDA e auditoria axe não foram executados. Não se declara conformidade
WCAG integral nem validação de operações bancárias reais. Permanece o aviso
existente de bundle JavaScript acima de 500 kB. Sem push, merge ou release.
