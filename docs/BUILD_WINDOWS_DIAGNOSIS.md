# Diagnóstico e validação do build no Windows

Data: 6 de novembro de 2026. Pasta validada: `C:\caminho\Valora`.

## Causa do ENOENT anterior

O Acesso Controlado a Pastas do Windows Defender bloqueou o Node ao criar os arquivos intermediários na pasta Documents. A evidência são eventos **1123** em `Microsoft-Windows-Windows Defender/Operational`, identificando `C:\Program Files\nodejs\node.exe` e `%userprofile%\Documents\Valora\`. Entre os registros estão 06/11/2026 às 12:59:46 e 13:22:34, horário de Brasília. O bloqueio foi apresentado pelo processo como `TS5033 / ENOENT`.

O diretório existe, não é link/junction e sua ACL NTFS permite modificação. A restrição do Defender é independente dessas permissões. Os eventos anteriores também registraram bloqueios de PowerShell, Git e Codex.

## Estado atual e distinção das restrições

Na nova investigação, o ENOENT não se reproduziu: o TypeScript conseguiu gravar seus metadados na pasta original. Não foi realizada nenhuma alteração de segurança por esta tarefa, e não se atribui a ela a mudança de disponibilidade de escrita.

A primeira execução atual, dentro do sandbox do agente, falhou em outra etapa: o esbuild recebeu `Acesso negado` ao ler diretórios superiores durante o carregamento de `vite.config.js`. A repetição autorizada fora do sandbox executou **o mesmo comando padrão**, na mesma pasta, e passou integralmente.

Portanto, foram observadas duas restrições ambientais distintas: bloqueio histórico de gravação pelo Defender e restrição de leitura do processo esbuild dentro do sandbox. Não foi encontrado defeito nos caminhos ou nas configurações de build que exigisse alteração do projeto.

## Configurações verificadas

- `package.json`: script original `tsc -b && vite build`, sem flags alternativas.
- `tsconfig.json`: referências válidas a `tsconfig.app.json` e `tsconfig.node.json`.
- Projeto app: `noEmit: true`; o modo build ainda grava `.tsbuildinfo`, comportamento esperado.
- Projeto node: `composite: true`, incluindo `vite.config.ts`; gera metadados, JavaScript e declarações ao lado da configuração.
- Destinos válidos: `tsconfig.app.tsbuildinfo`, `tsconfig.node.tsbuildinfo`, `vite.config.js`, `vite.config.d.ts`.
- Vite: saída padrão `dist`; nenhuma mudança em `outDir`, cache, carregador de configuração ou configuração Tauri.
- ACL da pasta: modificação permitida; diretório comum, sem redirecionamento.

## Resultado do comando padrão

`npm.cmd run build` foi executado em `C:\caminho\Valora`, fora do sandbox com autorização, e terminou com **código 0**. O comando inclui a verificação TypeScript e o build Vite.

- 124 módulos transformados.
- `dist/index.html`: 0,54 kB.
- CSS: 267,52 kB; gzip 46,71 kB.
- JavaScript: 1.226,55 kB; gzip 356,44 kB.
- Aviso não impeditivo preservado: chunk JavaScript acima de 500 kB.

Esta aprovação corresponde à **pasta original**, não a uma cópia nem a um build com saída temporária.

## Verificações finais

| Verificação | Resultado |
| --- | --- |
| `npm.cmd run build` fora do sandbox, na origem | Aprovado, código 0; inclui `tsc -b` e Vite |
| `node scripts/verify-refinement.mjs` | Aprovado na execução final; 21 destinos e cenários de teclado, foco, contraste e responsividade |
| Erros JavaScript capturados na execução final | Nenhum |
| Hosts externos acessados pela suíte | Nenhum; fixtures locais |
| `git diff --check` | Aprovado |
| Sintaxe dos dois scripts de QA alterados (`node --check`) | Aprovada |

Evidências da suíte final: `%TEMP%\valora-phase1-qa-VIUaup\verification-results.json`. As falhas transitórias de medição encontradas nas primeiras execuções estão descritas no escopo dos ajustes dos testes; não foram ocultadas por redução dos limites exigidos.

## Execução reproduzível no Windows

Em um terminal PowerShell normal do Windows, fora do sandbox do agente:

```powershell
# PowerShell · build padrão · Windows · Node/npm
Set-Location -LiteralPath 'C:\caminho\Valora'
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build não aprovado; examine a mensagem de erro.' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Verifique os problemas apontados no diff.' }
```

Se ENOENT voltar a ocorrer, consulte os eventos antes de modificar configurações:

```powershell
# PowerShell · evidências de bloqueio · Windows · Get-WinEvent
Get-WinEvent -FilterHashtable @{
    LogName = 'Microsoft-Windows-Windows Defender/Operational'
    Id = 1123
    StartTime = (Get-Date).AddDays(-1)
} -MaxEvents 30 | Where-Object { $_.Message -match 'Valora|node.exe' } |
    Select-Object TimeCreated, Id, Message
```

Caso uma política externa volte a impedir gravação em Documents, use uma cópia de desenvolvimento em uma pasta permitida fora de Documents, preservando a origem e suas alterações, ou solicite orientação ao administrador. Não é necessário desativar globalmente a proteção. Executar como administrador não foi a correção utilizada.

## Arquivos e escopo

Foram alterados este diagnóstico, a seção de compilação de `ICONOGRAPHY_ACCESSIBILITY_AUDIT.md`, `scripts/verify-design-system.mjs` e `scripts/verify-icon-accessibility.mjs`. Nos scripts de QA foram acrescentadas esperas pelo estilo computado do tema e pelo término do carregamento/atualização visual da origem antes das medições. As execuções iniciais capturaram cores do estado anterior durante essas atualizações. Nenhuma expectativa de cor ou limite de contraste foi removido ou flexibilizado.

Nenhum código funcional, Design System, configuração TypeScript/Vite, dependência, ACL ou configuração de segurança foi alterado. Arquivos intermediários e `dist` foram gerados pelo comando padrão. Alterações locais anteriores, incluindo `Cargo.lock`, foram preservadas. Sem push ou merge.
## Complemento: linker MSVC ausente no desenvolvimento Tauri (06/11/2026)

O erro `linker link.exe not found` da captura é independente do ENOENT anterior do TypeScript. O Rust usa o alvo `x86_64-pc-windows-msvc`; inicialmente não havia instalação utilizável dos Build Tools C++ nem Windows SDK. Instalar apenas VS Code não fornece esse linker. Não foi necessário alterar configurações TypeScript, Vite, Tauri ou código funcional.

Foi utilizado o bootstrapper oficial de Build Tools 2022 (`https://aka.ms/vs/17/release/vs_BuildTools.exe`), com assinatura Authenticode válida da Microsoft, para instalar `Microsoft.VisualStudio.Workload.VCTools` com componentes recomendados e sem reinício automático. Foram confirmados:

- MSVC `14.44.35207`, incluindo `VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/link.exe`.
- Windows SDK `10.0.26100.0`, incluindo `Lib/10.0.26100.0/um/x64/kernel32.lib`.
- Descoberta automática pelo Rust: a compilação foi executada em novo processo PowerShell sem adicionar caminhos globais ou configurar um linker absoluto no projeto.
- `cargo build --manifest-path src-tauri/Cargo.toml --locked`: aprovado, código 0, perfil dev concluído em 3m34s; gerou `src-tauri/target/debug/valora.exe` (21.310.976 bytes).
- `npm.cmd run build`: aprovado novamente, código 0 (`tsc -b` e Vite 7.3.7, 124 módulos). Permanece o aviso de bundle JavaScript maior que 500 kB.
- `git diff --check`: aprovado.
- Instalador concluído: `vswhere` confirmou Build Tools `17.14.37827.9` (17.14.44), `isComplete: true`, `isLaunchable: true`, `isRebootRequired: false`.
- `node scripts/verify-refinement.mjs`: aprovado na repetição após a compilação; código 0, nenhum erro JavaScript capturado, somente fixtures e nenhum host externo. Evidências: `%TEMP%\valora-phase1-qa-rolFzJ\verification-results.json`. A primeira tentativa desta rodada falhou com timeout de 30 segundos no carregamento inicial, enquanto instalação e Cargo estavam em andamento; nenhum teste foi modificado para a repetição.

Para repetir a validação e iniciar o aplicativo, em novo terminal no diretório do projeto:

```powershell
# PowerShell · Valora · Windows · Rust MSVC e Node/npm
cargo build --manifest-path src-tauri/Cargo.toml --locked
if ($LASTEXITCODE -ne 0) { throw 'Compilação nativa falhou.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build frontend falhou.' }
npm.cmd run tauri:dev
```

A validação acima comprova compilação/linkedição, não uma auditoria manual de todos os fluxos no WebView2. Não foram alteradas configurações globais de segurança do Windows. Alterações locais anteriores foram preservadas; sem push ou merge.
