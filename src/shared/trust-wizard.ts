// Pure helper for the post-join trust wizard trigger.
// Keeps the React-side decision testable without booting jsdom / RTL.

export interface TrustPromptInput {
  promptedAt: number;
  lastSeen: number;
  peers: ReadonlyArray<{ trusted: boolean }>;
}

/**
 * Decide whether the wizard should auto-open right now.
 *
 * - The main process must have bumped `promptedAt` since the last
 *   time the renderer saw it (lastSeen). This avoids re-firing the
 *   wizard on every state refresh after a join.
 * - There must be at least one peer that is NOT trusted. An empty
 *   room (just-created home, no peers discovered yet) skips the
 *   wizard so the user is not interrupted for no reason.
 */
export function shouldAutoOpenTrustWizard(input: TrustPromptInput): boolean {
  if (!input || input.promptedAt <= 0) return false;
  if (input.promptedAt <= input.lastSeen) return false;
  return (input.peers || []).some((peer) => !peer.trusted);
}