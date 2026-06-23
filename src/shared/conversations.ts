import type { ConversationRecord } from './protocol';

export function uniqueConversationMemberIds(values: unknown[] = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function conversationRecipientIds(record: Pick<ConversationRecord, 'memberIds'>, localDeviceId: string) {
  const localId = String(localDeviceId || '').trim();
  return uniqueConversationMemberIds(record.memberIds || []).filter((id) => id !== localId);
}

export function directConversationPeerId(record: Pick<ConversationRecord, 'id' | 'kind' | 'memberIds'>, localDeviceId: string) {
  const recipient = conversationRecipientIds(record, localDeviceId)[0];
  if (recipient) return recipient;
  return record.kind === 'direct' && record.id !== localDeviceId ? record.id : '';
}

export function conversationMessageMetadata(record: Pick<ConversationRecord, 'id' | 'kind' | 'title' | 'memberIds'>, localDeviceId: string) {
  const memberIds = uniqueConversationMemberIds([localDeviceId, ...(record.memberIds || [])]);
  return {
    conversationId: record.id,
    conversationKind: record.kind,
    conversationTitle: record.title,
    memberIds
  };
}
