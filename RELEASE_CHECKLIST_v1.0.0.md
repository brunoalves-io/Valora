# Valora v1.0.0 RC1 — Release Checklist

Objetivo: validar a primeira versão estável do Valora antes de promover para `v1.0.0`.

## Build e instalação
- [ ] CI concluído com sucesso
- [ ] Windows Build concluído com sucesso
- [ ] Instalador NSIS abre normalmente
- [ ] Instalação por cima da versão anterior preserva os dados do usuário
- [ ] Atalho da área de trabalho usa o novo ícone do Valora
- [ ] Barra de tarefas e janela usam o novo ícone do Valora
- [ ] Logo aparece corretamente na tela de login, onboarding e sidebar

## Autenticação
- [ ] Login com credenciais válidas
- [ ] Mensagem correta para senha incorreta
- [ ] Cadastro de novo usuário
- [ ] Confirmação de senha
- [ ] Logout
- [ ] Sessão persistente após reabrir o app

## Empresas e permissões
- [ ] Criar empresa
- [ ] Alternar entre empresas
- [ ] Editar dados da empresa
- [ ] Upload, troca e remoção da logo
- [ ] Líder
- [ ] Administrador
- [ ] Membro
- [ ] Visualizador
- [ ] Usuários sem permissão não conseguem executar ações restritas

## Financeiro
- [ ] Criar, editar e excluir lançamento
- [ ] Contas a pagar
- [ ] Contas a receber
- [ ] Contas e caixas
- [ ] Categorias
- [ ] Centros de custo
- [ ] Clientes
- [ ] Fornecedores
- [ ] Cartões
- [ ] Recorrências
- [ ] Relatórios
- [ ] Saldos e totais permanecem corretos após edições/exclusões

## Propostas
- [ ] Criar proposta
- [ ] Editar proposta
- [ ] Excluir proposta
- [ ] Cliente vinculado corretamente
- [ ] Logo e identidade da empresa disponíveis

## Valora IA
- [ ] Pergunta simples retorna resposta
- [ ] Dados utilizados pertencem à empresa ativa
- [ ] Retry automático funciona em erro transitório
- [ ] Fallback de modelo funciona quando necessário
- [ ] Mensagens de erro aparecem em PT-BR
- [ ] Botão “Tentar novamente” não duplica a pergunta

## UX/UI
- [ ] Modais de exclusão usam o padrão visual do Valora
- [ ] Nenhum popup “tauri.localhost diz”
- [ ] Sidebar e scrollbar corretas
- [ ] Campos de endereço organizados
- [ ] Estados vazios compreensíveis
- [ ] Sem textos cortados em 1280×800
- [ ] Sem quebras visuais em Full HD

## Critério de promoção
A RC1 só deve ser promovida para `v1.0.0` após todos os itens críticos acima estarem validados e sem bugs bloqueadores.
