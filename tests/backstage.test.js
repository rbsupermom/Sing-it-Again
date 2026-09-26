import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual client against controlled account and Firestore events.
// No production accounts or data are used.
function client({ bridgeSaves = true } = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, textContent: '', innerHTML: '', style: {},
      addEventListener() {}, classList: { toggle() {} }, setAttribute() {}
    });
    return nodes.get(id);
  };
  const feeds = [];
  const writes = [];
  const membershipUpdates = [];
  let state = { songs: [], sessions: [], performances: [] };
  const app = {
    storageKey: 'test', hadLocalState: false,
    emptyState: () => ({ songs: [], sessions: [], performances: [] }),
    getState: () => state,
    setState: next => { state = next; if (bridgeSaves) context.window.KaraokeCloud?.scheduleSave(next); },
    esc: value => String(value), showModal() {}, closeModal() {}, switchScreen() {}
  };
  const context = {
    window: { KaraokeApp: app },
    document: { getElementById: node, querySelector: node },
    localStorage: { getItem: () => null, setItem() {} },
    console, URLSearchParams, URL, location: { search: '', href: 'https://example.com/' },
    setTimeout: () => 1, clearTimeout() {},
    history: { replaceState() {} },
    alert: message => { throw new Error(message); },
    doc: (...parts) => parts.filter(value => typeof value === 'string').join('/'),
    collection: (...parts) => parts.filter(value => typeof value === 'string').join('/'),
    query: path => path, orderBy() {}, limit() {}, serverTimestamp: () => 'server-time',
    setDoc: async (path, data, options) => { writes.push({ path, data, options }); },
    getDocFromServer: async () => ({ exists: () => true, data: () => ({
      ownerUid: 'becca', partnerUid: 'erica', inviteeEmail: 'erica@example.com'
    }) }),
    updateDoc: async (...args) => { membershipUpdates.push(args); },
    onSnapshot: (path, ...args) => {
      const feed = { path, next: args.find(value => typeof value === 'function'), active: true };
      feeds.push(feed);
      return () => { feed.active = false; };
    }
  };
  let code = readFileSync('src/cloud.js', 'utf8').replace(/^import '[^']+';\n/gm, '').replace(/^import[\s\S]*?from '[^']+';\n/gm, '');
  code += `\nuser={uid:'erica',email:'erica@example.com'}; db={}; stateRef='users/erica/private/state'; ready=true;
    window.testClient={useState,listenPair,stopListeners,savePairConnection,scheduleSave,flush,acceptInvite};`;
  runInNewContext(code, context);
  const joined = { ownerUid: 'becca', partnerUid: 'erica', ownerName: 'Becca', partnerName: 'Erica' };
  const emitPair = id => feeds.findLast(feed => feed.active && feed.path === 'pairs/' + id)
    .next({ exists: () => true, data: () => joined });
  return { api: context.window.testClient, feeds, writes, membershipUpdates, node, emitPair, app };
}

test('a restored account connection opens Backstage and receives existing messages', () => {
  const c = client();
  c.api.useState({ songs: [], sessions: [], performances: [], pairId: 'pair1' });
  c.emitPair('pair1');
  const chat = c.feeds.find(feed => feed.active && feed.path === 'pairs/pair1/messages');
  assert.ok(chat, 'account snapshots must attach the chat listener');
  chat.next({ docs: [{ id: 'hello', data: () => ({ senderUid: 'becca', text: 'Ello', type: 'text' }) }] });
  assert.match(c.node('backstageMessages').innerHTML, /Ello/);
  assert.equal(c.node('backstageRoom').hidden, false);
});

test('reopening the same invite keeps all live conversation subscriptions', () => {
  const c = client();
  c.api.listenPair('pair1');
  c.emitPair('pair1');
  c.api.listenPair('pair1');
  c.emitPair('pair1');
  assert.equal(c.feeds.filter(feed => feed.active).length, 4);
  assert.equal(c.feeds.filter(feed => feed.active && feed.path.endsWith('/messages')).length, 1);
});

test('switching connections cannot display late messages from the previous room', () => {
  const c = client();
  c.api.listenPair('pair1');
  c.emitPair('pair1');
  const oldChat = c.feeds.find(feed => feed.path === 'pairs/pair1/messages');
  c.api.listenPair('pair2');
  c.emitPair('pair2');
  oldChat.next({ docs: [{ id: 'old', data: () => ({ senderUid: 'becca', text: 'stale-message' }) }] });
  assert.doesNotMatch(c.node('backstageMessages').innerHTML, /stale-message/);
  assert.ok(c.feeds.some(feed => feed.active && feed.path === 'pairs/pair2/messages'));
});

test('saving a joined invite persists independently of the app shell save hook', async () => {
  const c = client({ bridgeSaves: false });
  await c.api.savePairConnection('pair1');
  assert.ok(c.writes.some(write => write.data.backstagePairId === 'pair1'));
  assert.ok(c.writes.some(write => write.data.data?.pairId === 'pair1'));
  assert.ok(c.writes.every(write => write.options?.merge === true));
  c.api.useState({ songs: [], sessions: [], performances: [], pairId: null });
  assert.equal(c.app.getState().pairId, 'pair1', 'a library snapshot must not erase the connection');
});

test('sign-out stops the previous account subscriptions', () => {
  const c = client();
  c.api.listenPair('pair1');
  c.emitPair('pair1');
  c.api.stopListeners();
  assert.equal(c.feeds.filter(feed => feed.active).length, 0);
  assert.equal(c.node('backstageRoom').hidden, true);
});

test('an already accepted invite repairs a missing saved connection without rejoining', async () => {
  const c = client();
  const id = 'backstagePair1234567890';
  await c.api.acceptInvite(id);
  c.emitPair(id);
  assert.equal(c.membershipUpdates.length, 0);
  assert.ok(c.writes.some(write => write.data.backstagePairId === id));
  assert.equal(c.app.getState().pairId, id);
  assert.ok(c.feeds.some(feed => feed.active && feed.path === 'pairs/' + id + '/messages'));
});
