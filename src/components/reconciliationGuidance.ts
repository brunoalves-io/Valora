/** Presentation only: availability never implies a successful data load. */
export const OPEN_FINANCE_EMPTY_MESSAGE =
  "Nenhuma movimentação confirmada foi encontrada no feed Open Finance desta conta.";

type GuidanceInput = {
  accountId: string;
  accountCount: number;
  loadingAccount: boolean;
  loadingOpenFinance: boolean;
  parsing: boolean;
  linkedCount: number;
  parsedRows: number | null;
  error: string;
};

export function reconciliationGuidance(state: GuidanceInput) {
  if (!state.accountId) return {
    state: 'account', title: state.accountCount ? 'Selecione uma conta ou caixa' : 'Nenhuma conta disponível',
    description: state.accountCount ? 'Escolha a conta que será comparada com as movimentações bancárias.' : 'Cadastre uma conta em Contas e caixas para iniciar a conciliação.',
  };
  if (state.loadingAccount) return {state: 'account-loading', title: 'Verificando a conta selecionada', description: 'Aguarde a leitura das movimentações e dos vínculos disponíveis.'};
  if (state.loadingOpenFinance || state.parsing) return {
    state: 'loading', title: state.parsing ? 'Lendo o extrato selecionado' : 'Carregando movimentações do Open Finance',
    description: 'Aguarde a leitura. As movimentações aparecerão aqui para análise.',
  };
  if (state.error === OPEN_FINANCE_EMPTY_MESSAGE || (state.parsedRows === 0 && !state.error)) return {
    state: 'empty', title: 'Nenhuma movimentação encontrada',
    description: state.error === OPEN_FINANCE_EMPTY_MESSAGE ? 'A leitura terminou sem movimentações confirmadas para esta conta. Atualize os dados após uma nova sincronização ou importe um extrato.' : 'O arquivo foi lido, mas não contém movimentações válidas para análise. Escolha outro extrato.',
  };
  if (state.error) return {state: 'error', title: 'Não foi possível carregar os dados', description: 'Confira a mensagem de erro e tente novamente pela origem desejada.'};
  if (state.parsedRows !== null && state.parsedRows > 0) return {state: 'ready', title: 'Movimentações prontas para análise', description: 'Revise as correspondências e exceções antes de confirmar a conciliação.'};
  if (state.linkedCount) return {state: 'feed-ready', title: 'Open Finance disponível para esta conta', description: 'Use Atualizar dados para carregar as movimentações. O vínculo está disponível; a leitura ainda não foi realizada.'};
  return {state: 'file-ready', title: 'Importe um extrato para continuar', description: 'Selecione Importar arquivo e escolha um extrato CSV, Excel, ODS, OFX ou QFX. O Open Finance está indisponível enquanto esta conta não tiver vínculo.'};
}
