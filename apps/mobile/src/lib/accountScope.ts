/** Ephemeral identity guard only. Never log or persist this value (it includes a token). */
export function accountScope(state: { dataOwnerId?: string; dataOwnerServerUrl?: string; accessToken: string }): string {
  return JSON.stringify([state.dataOwnerId ?? '', state.dataOwnerServerUrl ?? '', state.accessToken]);
}
