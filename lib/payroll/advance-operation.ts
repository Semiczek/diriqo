export type AdvanceOperationPayload = Record<string, string | number | null>

/** A rejection of a retry cannot prove that the original attempt did not commit. */
export async function executeAdvanceOperation<T extends { ok: boolean; uncertain?: boolean }>(input: {
  pending: AdvanceOperationPayload | null
  payload: AdvanceOperationPayload
  companyId: string
  newOperationId: () => string
  store: (operation: AdvanceOperationPayload) => void
  clear: () => void
  action: (operation: AdvanceOperationPayload) => Promise<T>
}): Promise<T> {
  const operation = input.pending ?? { ...input.payload, companyId: input.companyId, operationId: input.newOperationId() }
  input.store(operation)
  const result = await input.action(operation)
  if (result.ok || (!input.pending && !result.uncertain)) input.clear()
  return result
}
