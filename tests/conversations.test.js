const assert = require('node:assert/strict');
const test = require('node:test');
const {
  conversationMessageMetadata,
  conversationRecipientIds,
  directConversationPeerId,
  uniqueConversationMemberIds
} = require('../dist/shared/conversations');

test('uniqueConversationMemberIds trims blanks and removes duplicates', () => {
  assert.deepEqual(uniqueConversationMemberIds(['local', ' peer-1 ', '', 'peer-1', null]), ['local', 'peer-1']);
});

test('conversationRecipientIds excludes the local device from group recipients', () => {
  assert.deepEqual(
    conversationRecipientIds({ memberIds: ['local', 'peer-1', 'peer-2', 'peer-1'] }, 'local'),
    ['peer-1', 'peer-2']
  );
});

test('directConversationPeerId resolves legacy direct conversation ids', () => {
  assert.equal(directConversationPeerId({
    id: 'peer-1',
    kind: 'direct',
    memberIds: ['local']
  }, 'local'), 'peer-1');
});

test('conversationMessageMetadata includes normalized member ids for group payloads', () => {
  assert.deepEqual(conversationMessageMetadata({
    id: 'conv:team',
    kind: 'group',
    title: 'Team',
    memberIds: ['local', 'peer-1', 'peer-2', 'peer-1']
  }, 'local'), {
    conversationId: 'conv:team',
    conversationKind: 'group',
    conversationTitle: 'Team',
    memberIds: ['local', 'peer-1', 'peer-2']
  });
});
