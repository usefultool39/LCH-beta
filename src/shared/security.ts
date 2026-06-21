export const CONTROL_MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;
export const CONTROL_REPLAY_CACHE_MAX_IDS = 2048;

export type ReplayPayload = {
  id?: unknown;
  fromId?: unknown;
  timestamp?: unknown;
};

export class ControlReplayGuard {
  private seenBySender = new Map<string, Map<string, number>>();

  constructor(
    private readonly maxAgeMs = CONTROL_MESSAGE_MAX_AGE_MS,
    private readonly maxIdsPerSender = CONTROL_REPLAY_CACHE_MAX_IDS
  ) {}

  validate(payload: ReplayPayload, now = Date.now()) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const fromId = typeof payload.fromId === 'string' ? payload.fromId.trim() : '';
    const timestamp = Number(payload.timestamp);

    if (!id || !fromId || !Number.isFinite(timestamp)) {
      throw new Error('控制消息缺少有效的重放保护字段');
    }
    if (Math.abs(now - timestamp) > this.maxAgeMs) {
      throw new Error('控制消息已过期或设备时间偏差过大');
    }

    this.prune(now);
    let seen = this.seenBySender.get(fromId);
    if (!seen) {
      seen = new Map<string, number>();
      this.seenBySender.set(fromId, seen);
    }
    if (seen.has(id)) {
      throw new Error('控制消息重复');
    }

    seen.set(id, timestamp);
    if (seen.size > this.maxIdsPerSender) {
      const oldest = seen.keys().next().value;
      if (oldest) seen.delete(oldest);
    }
    return true;
  }

  private prune(now: number) {
    const cutoff = now - this.maxAgeMs;
    for (const [sender, seen] of this.seenBySender) {
      for (const [id, timestamp] of seen) {
        if (timestamp < cutoff) seen.delete(id);
      }
      if (!seen.size) this.seenBySender.delete(sender);
    }
  }
}
