export function resolveHydratedStateValue(
  pendingValue: string | undefined,
  hydratedValue: string | null,
) {
  return pendingValue ?? hydratedValue;
}
