'use strict';
/* Rights with an end date, invitation links, activity (changes by members + refused attempts). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Members, readForm } = require('../server/members');
const { Readable } = require('stream');

function host(extra = {}) {
  const S = { general: {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-team-f-'));
  return {
    S, dir,
    ctx: { paths: { data: dir }, settings: { get: () => S, save: () => {} }, remote: { cfg: { user: 'admin', enabled: true }, sessions: new Map(), session: () => null, status: () => ({ enabled: true, domain: 'home.example.com', port: 443, urls: [] }) }, minecraft: { list: () => [] }, web: { list: () => [] }, dbm: { list: () => [] }, ...extra },
    t: (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s),
    error: (st, m) => Object.assign(new Error(m), { status: st }),
  };
}

test('rights with an end date: no sign-in and no requests afterwards', () => {
  const users = new Members(host());
  assert.throws(() => users.save({ name: 'Helper', password: 'helper-pass', until: Date.now() - 1000 }), /future/);
  const u = users.save({ name: 'Helper', password: 'helper-pass', services: ['mc:s'], areas: ['start-stop'], until: Date.now() + 3600000 });
  assert.ok(users.login('helper', 'helper-pass'));
  assert.ok(users.allowed({ method: 'POST', path: '/mc/servers/s/start' }, { userId: u.id }));
  users.list[0].until = Date.now() - 1; // abgelaufen
  assert.strictEqual(users.login('helper', 'helper-pass'), null);
  assert.strictEqual(users.allowed({ method: 'GET', path: '/overview' }, { userId: u.id }), false);
  assert.strictEqual(users.pub(users.list[0]).expired, true);
  users.save({ ...users.pub(users.list[0]), until: '' }, u.id);
  assert.strictEqual(users.list[0].until, null, 'empty = without end');
});

test('invitation link: works once, expires, never stores the token', async () => {
  const h = host();
  const users = new Members(h);
  const u = users.save({ name: 'Lena' });
  assert.strictEqual(users.pub(users.list[0]).hasPassword, false);
  const inv = users.invite(u.id, 24);
  assert.match(inv.link, /^https:\/\/home\.example\.com\/api\/team\/invite\/[\w-]{20,}$/);
  const token = inv.link.split('/').pop();
  assert.ok(!JSON.stringify(h.S).includes(token), 'only the hash is stored');
  assert.ok(users.pub(users.list[0]).invite && !users.pub(users.list[0]).invite.hash, 'page sees the end, not the hash');
  assert.strictEqual(users.byInvite(token).name, 'Lena');
  assert.throws(() => users.acceptInvite(token, 'short', 'short'), /8/);
  assert.throws(() => users.acceptInvite(token, 'long-enough-1', 'long-enough-2'), /not the same/);
  users.acceptInvite(token, 'long-enough-1', 'long-enough-1');
  assert.ok(users.login('lena', 'long-enough-1'));
  assert.strictEqual(users.byInvite(token), null, 'works once');
  assert.throws(() => users.acceptInvite(token, 'long-enough-1', 'long-enough-1'), /no longer valid/);
  const again = users.invite(u.id, 1);
  users.list[0].invite.until = Date.now() - 1;
  assert.strictEqual(users.byInvite(again.link.split('/').pop()), null, 'expired');
  assert.strictEqual(users.byInvite('nope'), null);
});

test('activity: changes by members from the change log plus refused attempts (kept on disk)', () => {
  const audit = { list: () => ({ items: [{ t: 5, user: 'Max', kind: 'Minecraft', target: 'Survival', action: 'gestartet', device: 'Browser' }, { t: 6, user: 'admin', kind: 'Web', target: 'x', action: 'y' }] }) };
  const h = host({ audit });
  const users = new Members(h);
  const u = users.save({ name: 'Max', password: 'max-password', services: ['mc:s'], areas: ['start-stop'] });
  assert.strictEqual(users.allowed({ method: 'PUT', path: '/settings/general' }, { userId: u.id }), false);
  assert.strictEqual(users.allowed({ method: 'PUT', path: '/settings/general' }, { userId: u.id }), false); // gleiche Anfrage: einmal notiert
  const a = users.activity();
  assert.deepStrictEqual(a.map((x) => [x.kind, x.user]), [['denied', 'Max'], ['change', 'Max']]);
  assert.strictEqual(a[0].text, 'PUT /settings/general');
  assert.ok(!a.some((x) => x.user === 'admin'), 'only members');
  assert.strictEqual(new Members(h).denied.length, 1, 'refused attempts survive a restart');
});

test('invitation form: JSON body or a plain form', async () => {
  assert.deepStrictEqual(await readForm({ body: { password: 'a' } }), { password: 'a' });
  const req = Readable.from([Buffer.from('password=abc%20def&repeat=x')]);
  req.body = {};
  assert.deepStrictEqual(await readForm(req), { password: 'abc def', repeat: 'x' });
});
