# Valora v1.0.41 — preparação e validação da release Windows

**Estado:** preparada para validação. Não publicada. A release oficial em produção permanece v1.0.40.

## Escopo
- Refinamento UX/UI, tipografia, responsividade Full HD/Ultrawide e Design System.
- Melhorias de iconografia, acessibilidade, navegação por teclado e formulários.
- Correções Tauri 2 do watcher do Vite e inicialização segura do updater.
- Nenhuma alteração intencional em regras de negócio, banco de dados ou cálculos financeiros.

## Sincronização de versão
Devem coincidir: `package.json`, raiz de `package-lock.json`, `packages[""]` de `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` e pacote `valora` de `src-tauri/Cargo.lock`. Versão alvo: **1.0.41**; tag oficial futura **v1.0.41**.

## Portões de validação antes da publicação
1. Abrir PR desta branch para `main`, rodar CI frontend e revisar diff. Não executar merge sem aprovação.
2. No GitHub Actions `Valora Windows Build`, usar **Run workflow**, branch `chore/prepare-v1.0.41`, `publish_release=false`, sem release_tag. O build de ensaio deve criar artefato `Valora-Windows-Installer` contendo instalador NSIS e `.exe.sig`, mas não publicar release.
3. Conferir nos logs o carregamento das credenciais do updater via Actions variable `VALORA_UPDATER_PUBLIC_KEY` e secrets de assinatura sem exibir seus valores. O build deve falhar se a chave pública estiver ausente; não criar ou enviar chave privada ao repositório.
4. Baixar artefato do workflow de ensaio, conferir o SHA-256 e instalar o NSIS em Windows 11 de teste. Confirmar versão 1.0.41, logo/ícones, janela inicial, login, dashboard, conciliação, listas e fluxo de atualização desabilitado ou habilitado conforme configuração esperada.
5. Testar atualização **assinada** de uma instalação 1.0.40 para 1.0.41 em ambiente controlado, verificando chave de confiança, `.sig` e `latest.json`, sem substituir a release pública antes do aceite. Um build e uma assinatura existentes não comprovam o ciclo de atualização.
6. Após aprovação explícita, integrar a branch à `main` e executar o workflow manual com `publish_release=true` e `release_tag=v1.0.41`. A versão dos três manifests deve coincidir.
7. Conferir na página de Releases `Valora_1.0.41_x64-setup.exe`, sua assinatura `.sig` e `latest.json`. Confirmar download e comportamento do atualizador. Não declarar a release publicada antes dessa verificação.

## Atenção ao workflow existente
O workflow atual também publica **automaticamente** quando há push em branches `release/**`, e sua etapa final **remove releases anteriores** após publicação. Por isso esta preparação usa `chore/prepare-v1.0.41` e não cria branch `release/**` nem publica nada. Antes da publicação, revisar esse comportamento e preservar o instalador anterior para eventual rollback até que a nova versão seja validada.

## Limitações desta etapa
- Alterações aqui são somente de preparação do código e documentação.
- Nenhum artefato Windows foi compilado por esta etapa.
- Nenhum tag, release, instalador, assinatura, segredo, banco de dados ou atualização automática foi criado/modificado.
