# Preparação para publicação

Branch revisada: `ux/apple-hig-fase1`. Destino proposto: `origin/ux/apple-hig-fase1`.
Push depende de aprovação do usuário; não foi feito merge em `main`.

## Escopo preservado

- Refinamentos visuais, responsividade, ícones SVG e navegação por teclado.
- Foco dos diálogos, semântica dos controles de conciliação e mensagens de status.
- Exclusão de `src-tauri` do watcher Vite e inicialização opcional segura do Updater.
- Contratos dos comandos Rust e verificação de assinatura das atualizações.

Nenhuma mudança adicional de regras de negócio, cálculos, banco ou autenticação
foi realizada nesta preparação. Os diffs de componentes acumulados se concentram
em apresentação e interação acessível; os algoritmos financeiros não foram alterados.

## Arquivos excluídos do versionamento

O `.gitignore` cobre `.env` e variantes (exceto o exemplo), material privado de
assinatura, `dist`, `target`, `node_modules`, logs, intermediários TypeScript,
`vite.config.js`/`.d.ts`, schemas Tauri gerados e ícones de plataformas não usadas.
Esses arquivos permanecem no disco. Os PNGs e ICO referenciados em
`tauri.conf.json` são recursos de empacotamento e foram mantidos; os dois lockfiles
também são fontes de reprodutibilidade, não caches.

## Revisão de conteúdo

Foram revisados os diffs e os arquivos novos de código, estilos, testes,
documentação, lockfiles e recursos de ícone. A varredura local das alterações não
encontrou padrões de chaves privadas, tokens GitHub/AWS, chaves secretas Supabase,
JWTs literais ou atribuições suspeitas de credenciais. O `.env.local` está ignorado;
apenas `.env.example` já consta no histórico rastreado. As credenciais de teste são
fixtures sintéticas. Os 145 registros do lockfile npm foram analisados: nenhuma URL
de pacote fora de `registry.npmjs.org` ou contendo credenciais. Não se trata de uma
auditoria de todo o histórico Git. Caminhos pessoais foram generalizados nos relatórios.

## Validação desta preparação

- `npm.cmd run build`: aprovado, incluindo TypeScript e Vite (124 módulos).
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`: aprovado; três testes
  unitários, além dos alvos binário e documentação sem testes adicionais.
- `node --check` nos quatro scripts de verificação: aprovado.
- `node scripts/verify-refinement.mjs`: aprovado, fixtures locais, nenhum erro
  JavaScript capturado e nenhum host externo acessado. Evidências locais:
  `%TEMP%\valora-phase1-qa-Hfuku5\verification-results.json`.
- `git diff --check`: aprovado.

Aviso remanescente: bundle JavaScript acima de 500 kB. A suíte visual usa ferramentas
opcionais externas indicadas por `VALORA_QA_TOOLS` e `VALORA_QA_BROWSER`; não foram
adicionadas dependências de QA ao aplicativo. Não foram repetidos testes manuais
com leitores de tela nem instalação de atualização real assinada nesta preparação.
