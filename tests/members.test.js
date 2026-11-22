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
  const o = users.filterOverview({ web: [{ id: 'a' }], db: [], minecraft: [{ id: 'survival' }, { id: 'other' }], apps: [], mail: { installed: true, config: { smtpPort: 2525, relay: { pass: 'x' } }, count: 7, unread: 3, proc: { state: 'running' } } }, sess);
  assert.strictEqual(o.minecraft.length, 1); assert.strictEqual(o.web.length, 0); assert.strictEqual(o.member.name, 'Max'); assert.deepStrictEqual(o.mail, { installed: true, config: { smtpPort: 2525 }, count: 0, unread: 0, trash: 0, proc: { state: 'running' } }, 'mail catcher: shape for the overview, no mails or relay');
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

test('users.can and Discord ID: same rules as remote access, for the Discord bot and other extensions', () => {
  const h = host('de');
  const users = new Members(h);
  const m = users.save({ name: 'Lena', role: 'mitglied', services: ['mc:survival', 'game:valheim'], areas: ['start-stop'], discordId: '123456789012345678' });
  const a = users.save({ name: 'Boss', role: 'admin', discordId: '' });
  assert.strictEqual(m.discordId, '123456789012345678');
  assert.ok(!('discordId' in users.get(a.id)), 'empty = none');
  // gleiche Discord-ID darf nicht zweimal vergeben werden, falsche Form wird abgelehnt
  assert.throws(() => users.save({ name: 'Kim', discordId: '123456789012345678' }), /anderen Mitglied/);
  assert.throws(() => users.save({ name: 'Kim', discordId: '12ab' }), /17–20 Ziffern/);
  // can(): Dienst freigegeben UND Bereich erlaubt; { kind, id } aus Hostwerk.services() geht auch
  assert.ok(users.can(m.id, 'mc:survival', 'start-stop'));
  assert.ok(users.can(m.id, { kind: 'minecraft', id: 'survival' }, 'start-stop'));
  assert.ok(users.can(m.id, { kind: 'game', id: 'valheim' }));
  assert.ok(!users.can(m.id, 'mc:survival', 'console'), 'area not allowed');
  assert.ok(!users.can(m.id, 'mc:creative', 'start-stop'), 'service not shared');
  assert.ok(!users.can(m.id, 'mc:survival', 'fly'), 'unknown area');
  assert.ok(users.can(a.id, 'web:anything', 'files'), 'admin: everything');
  assert.ok(!users.can('nobody', 'mc:survival'));
  assert.strictEqual(users.serviceKey('db', 'main'), 'dbs:main'); assert.strictEqual(users.serviceKey('docker', 'redis'), 'apps:redis'); assert.strictEqual(users.serviceKey('mail', 'mail'), null);
  // byDiscord: nur eingeschaltete, nicht abgelaufene
  assert.strictEqual(users.byDiscord('123456789012345678').name, 'Lena');
  assert.strictEqual(users.byDiscord('999999999999999999'), null); assert.strictEqual(users.byDiscord('x'), null);
  users.get(m.id).enabled = false;
  assert.strictEqual(users.byDiscord('123456789012345678'), null);
  assert.ok(!users.can(m.id, 'mc:survival', 'start-stop'), 'switched off');
  users.get(m.id).enabled = true; users.get(m.id).until = Date.now() - 1000;
  assert.ok(!users.can(m.id, 'mc:survival', 'start-stop'), 'expired');
  // Discord-ID entfernen
  users.get(m.id).until = null;
  assert.ok(!('discordId' in users.save({ name: 'Lena', discordId: '' }, m.id)));
});

test('members: no umlauts (remote sign-in cannot), short password creates nothing, no rename onto the main account', () => {
  const users = new Members(host('en'));
  assert.throws(() => users.save({ name: 'Jürgen', password: 'juergen-pass' }), /without umlauts/, 'Hostwerk’s remote sign-in fails for names with ä, é …');
  assert.throws(() => users.save({ name: 'M'.repeat(41), password: 'juergen-pass' }), /2–40/, 'too long is refused, not cut silently');
  const j = users.save({ name: 'Juergen Zoe', password: 'juergen-pass' });
  assert.ok(users.login('juergen zoe', 'juergen-pass'));
  assert.throws(() => users.save({ name: 'Anna', password: 'short' }), /8 characters/);
  assert.strictEqual(users.list.length, 1, 'a refused password leaves no half-created member behind');
  assert.throws(() => users.save({ name: 'Admin', password: 'x'.repeat(10) }, j.id), /main remote access account/, 'no rename onto the main account');
  assert.throws(() => users.save({ name: 'a<b>', password: 'x'.repeat(10) }), /2–40/);
});

test('members: always-allowed lists and settings come back shortened (no other services, no password hashes)', () => {
  const h = host('en');
  h.S.users = [];
  h.S.live = { remote: { passHash: 'scrypt:x:y', totp: 'secret' } };
  h.S.general = { language: 'en', theme: 'dark', ui: { prefs: { a: '1' } }, notifications: { discord: 'https://discord.example/hook' } };
  h.S.ai = { disabled: true, providers: [{ key: 'sk-test' }] };
  const users = new Members(h);
  const u = users.save({ name: 'Mia', password: 'mia-password', services: ['mc:survival', 'game:g1'], areas: ['start-stop'] });
  const sess = { userId: u.id };
  const ask = (p, body) => {
    let sent; const res = { statusCode: 200, json: (b) => { sent = b; return res; } };
    assert.strictEqual(users.allowed({ path: p, method: 'GET', res }, sess), true, p);
    res.json(body); return sent;
  };
  assert.deepStrictEqual(ask('/mc/servers', [{ id: 'survival' }, { id: 'secret' }]).map((x) => x.id), ['survival']);
  const g = ask('/games', { linux: false, servers: [{ id: 'g1' }, { id: 'g2' }] });
  assert.deepStrictEqual(g.servers.map((x) => x.id), ['g1']); assert.strictEqual(g.linux, false);
  assert.deepStrictEqual(ask('/web', [{ id: 'shop' }]), []);
  const s = ask('/settings', h.S);
  assert.deepStrictEqual(s, { general: { language: 'en', theme: 'dark', ui: { prefs: { a: '1' } } }, ai: { disabled: true } });
  assert.ok(!/passHash|sk-test|discord|scrypt/.test(JSON.stringify(s)), 'no hashes, keys or notification targets');
  const sum = ask('/summary', { version: '3', services: { running: 1, total: 4, errors: ['Secret server'] }, problems: ['Secret server: crashed'] });
  assert.deepStrictEqual(sum.services.errors, []); assert.deepStrictEqual(sum.problems, []);
  // the owner and admins get everything unchanged; error answers stay as they are
  let raw; const res = { statusCode: 200, json: (b) => { raw = b; } };
  users.allowed({ path: '/settings', method: 'GET', res }, null); res.json(h.S); assert.strictEqual(raw, h.S);
});

test('team setups: a refused address keeps the connection, broken files give a clear message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-team-c-'));
  const h = host('en');
  const team = new TeamSetups(h, { timers: false });
  await team.configure({ source: 'folder', location: dir });
  await assert.rejects(team.configure({ source: 'url', location: 'http://insecure' }), /https/);
  await assert.rejects(team.configure({ source: 'folder', location: path.join(dir, 'missing') }), /Folder not found/);
  assert.strictEqual(team.state().source, 'folder'); assert.strictEqual(team.state().location, dir);
  fs.writeFileSync(path.join(dir, 'hostwerk-team.json'), '{ broken');
  assert.match((await team.check()).error, /not a Hostwerk setup/);
  const off = await team.configure({ source: null });
  assert.strictEqual(off.source, null); assert.strictEqual(off.error, null, 'disconnecting clears the old message');
});

test('members: overview kinds are filtered, legacy lists of other kinds left out; services without the Minecraft extension', () => {
  const h = host('en');
  delete h.ctx.minecraft; // Minecraft is its own extension – not installed here
  h.ctx.web = { list: () => [{ id: 'shop', name: 'Shop' }] };
  const users = new Members(h);
  assert.deepStrictEqual(users.services().map((s) => s.id), ['web:shop'], 'web servers still listed without ctx.minecraft');
  const u = users.save({ name: 'Mia', password: 'mia-password', services: ['mc:a', 'game:g1'], areas: ['start-stop'] });
  const o = users.filterOverview({ web: [{ id: 'shop' }], db: [], apps: [], vms: [{ id: 'secret-vm' }], app: { version: '3' },
    kinds: { mc: { label: 'Minecraft', items: [{ id: 'a' }, { id: 'b' }] }, game: { items: [{ id: 'g1' }, { id: 'g2' }] }, vm: { label: 'VMs', items: [{ id: 'secret-vm' }] } } }, { userId: u.id });
  assert.deepStrictEqual(o.kinds.mc.items.map((x) => x.id), ['a']);
  assert.deepStrictEqual(o.kinds.game.items.map((x) => x.id), ['g1']);
  assert.deepStrictEqual(o.kinds.vm.items, [], 'kinds without a sharing rule stay empty');
  assert.strictEqual(o.kinds.mc.label, 'Minecraft', 'kind metadata stays for the interface');
  assert.strictEqual(o.vms, undefined, 'unknown legacy lists are left out');
  assert.strictEqual(o.web.length, 0); assert.strictEqual(o.app.version, '3');
});
