'use strict';
/*
 * Members with roles: create, sign in, rights enforcement, filtered overview, admin role, disabled users,
 * team setups from a shared folder (publish, detect, take over, dismiss).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Members } = require('../server/members');
const { TeamSetups } = require('../server/setups');
const de = require('../locales/de.json');

const fill = (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s);
function host(lang = 'en') {
  const S = { general: { language: lang } };
  const profile = { export: () => ({ hostwerkProfile: 1, from: 'test', exportedAt: Date.now(), web: [] }), preview: () => ({ items: [{ name: 'Web server', exists: true }] }), import: () => ({ id: 'job1', promise: Promise.resolve() }) };
  return {
    S,
    ctx: { settings: { get: () => S, save: () => {} }, remote: { cfg: { user: 'admin', enabled: true }, sessions: new Map(), session: () => null }, minecraft: { list: () => [{ id: 'survival', name: 'Survival' }] }, web: { list: () => [] }, dbm: { list: () => [] }, apps: { list: () => [] }, profile },
    t: (s, v) => fill(lang === 'de' && de[s] ? de[s] : s, v),
    error: (st, m) => Object.assign(new Error(m), { status: st }),
    broadcast: () => {},
  };
}

test('members: create, sign in, rights, filtered overview, admin', () => {
  const h = host('en');
  const users = new Members(h);
  const u = users.save({ name: 'Max', password: 'max-password', role: 'mitglied', services: ['mc:survival'], areas: ['start-stop', 'console'] });
  assert.ok(u.id && u.hasPassword && u.passHash === undefined, 'no password hash leaves the server');
  assert.throws(() => users.save({ name: 'Max', password: 'x'.repeat(10) }), /already taken/);
  assert.throws(() => users.save({ name: 'admin', password: 'x'.repeat(10) }), /main remote access account/);
  assert.ok(users.login('max', 'max-password'));
  assert.strictEqual(users.login('max', 'wrong'), null);
  const sess = { userId: u.id, user: 'Max' };
  const can = (p, m) => users.allowed({ path: p, method: m }, sess);
  assert.strictEqual(can('/mc/servers/survival/start', 'POST'), true);
  assert.strictEqual(can('/mc/servers/survival/command', 'POST'), true);
  assert.strictEqual(can('/mc/servers/survival/players', 'POST'), false, 'players not shared');
  assert.strictEqual(can('/mc/servers/other/start', 'POST'), false, 'other server not shared');
  assert.strictEqual(can('/settings/general', 'PUT'), false);
  assert.strictEqual(can('/pw', 'GET'), false);
  assert.strictEqual(can('/overview', 'GET'), true);
  assert.strictEqual(can('/mc/servers', 'GET'), true);
  assert.strictEqual(can('/logs/mc:survival', 'GET'), false, 'logs not shared');
  const o = users.filterOverview({ web: [{ id: 'a' }], db: [], minecraft: [{ id: 'survival' }, { id: 'other' }], apps: [], mail: {} }, sess);
  assert.strictEqual(o.minecraft.length, 1); assert.strictEqual(o.web.length, 0); assert.strictEqual(o.member.name, 'Max'); assert.strictEqual(o.mail, null);
  const adm = users.save({ name: 'Boss', password: 'boss-password', role: 'admin' });
  assert.strictEqual(users.allowed({ path: '/settings/general', method: 'PUT' }, { userId: adm.id }), true);
  assert.strictEqual(users.allowed({ path: '/anything', method: 'DELETE' }, null), true, 'local app / main account');
  users.save({ ...u, enabled: false }, u.id);
  assert.strictEqual(users.login('max', 'max-password'), null, 'disabled users cannot sign in');
  assert.strictEqual(can('/overview', 'GET'), false, 'disabled users are refused');
  users.remove(u.id); users.remove(adm.id);
  assert.strictEqual(users.list.length, 0);
  assert.strictEqual(h.S.users.length, 0, 'data lives in settings.users as before');
});

test('members: messages in German', () => {
  const users = new Members(host('de'));
  assert.throws(() => users.save({ name: 'x' }), /2–40 Zeichen/);
  assert.throws(() => users.save({ name: 'Anna', password: 'kurz' }), /mindestens 8 Zeichen/);
});

test('team setups from a shared folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-team-'));
  const h = host('en');
  const team = new TeamSetups(h, { timers: false });
  await assert.rejects(team.configure({ source: 'url', location: 'http://insecure' }), /https/);
  let st = await team.configure({ source: 'folder', location: dir });
  assert.match(st.error, /no hostwerk-team\.json/);
  st = team.publish('added Redis');
  assert.ok(fs.existsSync(path.join(dir, 'hostwerk-team.json')));
  assert.ok(!st.update, 'own published version is not "new"');
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'hostwerk-team.json'), 'utf8'));
  file.team.note = 'Changed by a colleague';
  fs.writeFileSync(path.join(dir, 'hostwerk-team.json'), JSON.stringify(file));
  st = await team.check();
  assert.ok(st.update && st.update.note === 'Changed by a colleague', JSON.stringify(st));
  const job = team.apply();
  await job.promise; await new Promise((r) => setTimeout(r, 10));
  assert.ok(!team.state().update, 'taken over');
  assert.throws(() => team.apply(), /no new version/);
});

test('every German text has a value', () => {
  for (const [k, v] of Object.entries(de)) if (k !== '$patterns') assert.ok(typeof v === 'string' && v.trim(), k);
});
