import test from 'node:test';
import assert from 'node:assert/strict';
import { canReportDm, dmReportBody, dmReportError, DM_REPORT_REASONS } from '../src/chat/dm-report.js';

const dm = { kind: 'dm', username: 'bob' };
const grp = { kind: 'group', room: 'grp_abc' };
const fromBob = { id: 'im12', imId: 12, author: { username: 'bob' }, body: 'hi' };
const gFromBob = { id: 'ga1b2', gid: 'a1b2', author: { username: 'bob' }, body: 'hi' };

test('only saved messages from someone else in a DM or group can be reported', () => {
  assert.equal(canReportDm(dm, fromBob, 'alice'), true);
  assert.equal(canReportDm(grp, gFromBob, 'alice'), true);
  assert.equal(canReportDm(dm, fromBob, 'Bob'), false, 'own message');
  assert.equal(canReportDm(dm, { ...fromBob, pending: true }, 'alice'), false);
  assert.equal(canReportDm(dm, { ...fromBob, system: true }, 'alice'), false);
  assert.equal(canReportDm(dm, { ...fromBob, imId: undefined }, 'alice'), false, 'not saved yet');
  assert.equal(canReportDm({ kind: 'dm', username: 'System' }, fromBob, 'alice'), false);
  assert.equal(canReportDm({ kind: 'channel', cid: 'c1' }, fromBob, 'alice'), false, 'channels have their own report');
  assert.equal(canReportDm(grp, { ...gFromBob, gid: null }, 'alice'), false);
});

test('the request body: DM by mail id, group by room + message id', () => {
  assert.deepEqual(dmReportBody(dm, fromBob, 'spam', ''), { message_id: '12', reason: 'spam' });
  assert.deepEqual(dmReportBody(grp, gFromBob, 'threats', '  please look '), { room: 'grp_abc', message_id: 'a1b2', reason: 'threats', details: 'please look' });
  assert.equal(dmReportBody(dm, fromBob, 'nope', ''), null);
  assert.equal(dmReportBody(dm, fromBob, 'other', 'x'.repeat(2000)).details.length, 1000);
  assert.deepEqual(DM_REPORT_REASONS.map(r => r[0]), ['harassment', 'spam', 'nsfw', 'threats', 'other']);
});

test('server errors read as plain sentences', () => {
  assert.match(dmReportError('not_a_participant'), /your own conversations/);
  assert.match(dmReportError('rate_limited', 'Too many reports - try again in an hour.'), /hour/);
  assert.match(dmReportError('whatever'), /try again/);
});
