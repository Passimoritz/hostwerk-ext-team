'use strict';
/*
 * Rights rules against Hostwerk's real route list: every route of the core (and of the game server extension) under a
 * service – /mc/servers/:id/…, /games/:id/…, /web|dbs|apps/:id/…, /logs/:svc, /stats/:svc – needs a decision: members may
 * reach it (MEMBER_ROUTES, with an area) or it stays with the admins (ADMIN_ONLY). A new core route without a decision
 * makes this test fail instead of silently being refused – or, worse, slipping through a loose prefix.
 * The route list is READ from the Hostwerk repository next to this one (or HOSTWERK_DIR); without it the test is skipped.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { MEMBER_ROUTES, ADMIN_ONLY, ALWAYS, classify, memberAllows, AREAS } = require('../server/members');

const HOSTWERK = process.env.HOSTWERK_DIR || path.join(__dirname, '..', '..', '..', 'hostwerk');
const GAMES = path.join(__dirname, '..', '..', 'hostwerk-ext-game-servers', 'server');
const SERVICE_ROUTE = /^\/(mc\/servers|games|web|dbs|apps)\/:id(\/|$)|^\/(logs|stats)\/:svc$/;

/** All "<METHOD> <template>" of r.get('/…') / api.post('/…') … in the JavaScript files below dir (no node_modules). */
function routesIn(dir) {
  const out = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.js')) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:r|api|router|app)\.(get|post|put|delete|patch)\(\s*'(\/[^']*)'/g)) out.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
  };
  walk(dir);
  return [...out].sort();
}
/** A concrete path for a template: :id → the shared service "x", :svc → "mc:x", other parameters → "p". */
const concrete = (tpl) => tpl.replace(/:(\w+)/g, (m, k) => ({ id: 'x', svc: 'mc:x' })[k] || 'p');
const ALL_AREAS = Object.keys(AREAS);
const everything = { services: ['mc:x', 'game:x', 'web:x', 'dbs:x', 'apps:x'], areas: ALL_AREAS };
const nothing = { services: [], areas: [] };
const have = fs.existsSync(path.join(HOSTWERK, 'server', 'index.js'));

test('every service route of Hostwerk has a decision (member area or admin only)', { skip: !have && 'Hostwerk repository not next to this one (set HOSTWERK_DIR)' }, () => {
  const routes = [...routesIn(path.join(HOSTWERK, 'server')), ...(fs.existsSync(GAMES) ? routesIn(GAMES) : [])];
  assert.ok(routes.length > 200, `found only ${routes.length} routes – did the route style change?`);
  const admin = new Set(ADMIN_ONLY);
  const undecided = [];
  for (const r of routes) {
    const [method, tpl] = r.split(' ');
    if (!SERVICE_ROUTE.test(tpl)) continue;
    const forMember = memberAllows(everything, method, concrete(tpl));
    if (forMember && admin.has(r)) undecided.push(`${r} – in ADMIN_ONLY, but members reach it`);
    else if (!forMember && !admin.has(r)) undecided.push(`${r} – new? decide: MEMBER_ROUTES (with an area) or ADMIN_ONLY`);
  }
  assert.deepStrictEqual(undecided, [], `Routes without a decision:\n${undecided.join('\n')}`);
});

test('without shares a member reaches only the exact always-allowed routes – nothing by prefix', { skip: !have && 'Hostwerk repository not next to this one' }, () => {
  const routes = routesIn(path.join(HOSTWERK, 'server'));
  const allowed = routes.filter((r) => { const [m, tpl] = r.split(' '); return memberAllows(nothing, m, concrete(tpl)); });
  const always = new Set(ALWAYS.map(([m, tpl]) => `${m} ${tpl}`));
  const unexpected = allowed.filter((r) => !always.has(r) && !always.has(`* ${r.split(' ')[1]}`));
  assert.deepStrictEqual(unexpected, []);
  // Früher offene Präfixe: alle abmelden, Einstellungen anderer Erweiterungen, Discord-Bot
  for (const [m, p] of [['POST', '/live/remote/logout-all'], ['GET', '/discord-bot'], ['GET', '/settingsx'], ['GET', '/users/meX'], ['GET', '/jobs/1/x']]) assert.strictEqual(memberAllows(nothing, m, p), false, `${m} ${p}`);
});

test('ADMIN_ONLY lists only routes that still exist (no stale decisions)', { skip: !have && 'Hostwerk repository not next to this one' }, () => {
  const routes = new Set([...routesIn(path.join(HOSTWERK, 'server')), ...(fs.existsSync(GAMES) ? routesIn(GAMES) : [])]);
  const stale = ADMIN_ONLY.filter((r) => !routes.has(r));
  assert.deepStrictEqual(stale, []);
});

test('rules are anchored and give the right area', () => {
  const member = { services: ['mc:srv', 'web:shop', 'game:val', 'apps:api'], areas: ['start-stop', 'logs'] };
  const can = (m, p) => memberAllows(member, m, p);
  assert.ok(can('POST', '/mc/servers/srv/kill'), 'kill counts as stopping');
  assert.ok(can('POST', '/web/shop/kill'));
  assert.ok(can('GET', '/mc/servers/srv/logs'));
  assert.ok(can('GET', '/logs/mc:srv') && can('GET', '/logs/app:api') && can('GET', '/logs/shop'));
  assert.ok(can('POST', '/games/val/start'));
  assert.ok(!can('POST', '/games/val/update'), 'other game commands stay with admins');
  assert.ok(!can('POST', '/games/val/send'), 'console not shared');
  assert.ok(!can('GET', '/mc/servers/srv/worlds/w/download'), 'world download needs backups');
  assert.ok(!can('GET', '/mc/servers/srv/playersx'), 'no prefix matches');
  assert.ok(!can('POST', '/mc/servers/other/start'), 'only shared services');
  assert.strictEqual(classify('GET', '/mc/servers/srv').rule.area, 'start-stop');
  assert.strictEqual(classify('GET', '/nope'), null);
  for (const [, tpl, , area] of MEMBER_ROUTES) assert.ok(AREAS[area], `${tpl}: unknown area ${area}`);
});
