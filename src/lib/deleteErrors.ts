type DeleteError = {
  code?: string | null;
  message?: string | null;
};

export function getDeleteErrorMessage(
  error: DeleteError | null | undefined,
  entityLabel: string,
  dependencyMessage?: string,
) {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  if (
    code === "23503" ||
    message.includes("foreign key") ||
    message.includes("violates foreign key constraint")
  ) {
    return (
      dependencyMessage ||
      `Não é possível excluir ${entityLabel} porque existem registros vinculados.`
    );
  }

  if (message.includes("permission") || message.includes("row-level security")) {
    return `Você não tem permissão para excluir ${entityLabel}.`;
  }

  return `Não foi possível excluir ${entityLabel}. Tente novamente.`;
}
