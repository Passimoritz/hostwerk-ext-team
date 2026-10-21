'use strict';
/*
 * Several users with roles: friends may start "their" Minecraft or game server or manage players – without access to the
 * rest. Each person signs in to remote access with their own name (password, optionally passkey); sign-in itself and
 * passkeys stay in Hostwerk's core, this extension decides what a member may do.
 *   Roles: admin (everything) · member (only shared services and areas)
 *   Rights per member: services = service ids (mc:<id>, game:<id>, web:<id>, dbs:<id>, apps:<id>), areas
 *   (console, players, backups, files, logs, start-stop)
 * Enforced in the API (Hostwerk asks allowed(req, session) before every request); the local app is always admin.
 * Data stays where it always was: settings.users (role values "admin" / "mitglied" as before).
 */
const crypto = require('crypto');

const ROLE_MEMBER = 'mitglied'; // stored value (kept for existing data)
const AREAS = { 'start-stop': 'Start, stop, restart', console: 'Console and commands', players: 'Manage players (whitelist, ban, op)', backups: 'Create/restore backups', files: 'Files of the service', logs: 'Read logs' };
const hashPw = (pw) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, 32).toString('hex')}`; };
const checkPw = (pw, stored) => { try { const [, s, h] = String(stored || '').split('$'); return crypto.timingSafeEqual(crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 32), Buffer.from(h, 'hex')); } catch { return false; } };

/**
 * What a member may reach – a table of route templates instead of loose regular expressions: every entry is anchored,
 * so a new core route never slips in by prefix (e.g. /live/remote/logout-all, /discord-bot). Routes under a shared
 * service that are not listed here are refused; tests/routes.test.js reads Hostwerk's route list and fails for every
 * service route that is neither here nor in ADMIN_ONLY – a new core route always gets a decision.
 *   [method or '*', template, kind, area]  – :id = the shared service, kind null = the first path part (web, dbs, apps)
 */
const MEMBER_ROUTES = [
  // Minecraft
  ['POST', '/mc/servers/:id/start', 'mc', 'start-stop'], ['POST', '/mc/servers/:id/stop', 'mc', 'start-stop'], ['POST', '/mc/servers/:id/restart', 'mc', 'start-stop'], ['POST', '/mc/servers/:id/kill', 'mc', 'start-stop'],
  ['GET', '/mc/servers/:id', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/stats', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/selftest', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/ping', 'mc', 'start-stop'],
  ['GET', '/mc/servers/:id/gamerules', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/worlds', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/icon', 'mc', 'start-stop'],
  ['GET', '/mc/servers/:id/plugins', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/plugins/icon', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/plugins/sources', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/plugins/updates', 'mc', 'start-stop'],
  ['POST', '/mc/servers/:id/command', 'mc', 'console'],
  ['GET', '/mc/servers/:id/logs', 'mc', 'logs'],
  ['*', '/mc/servers/:id/players', 'mc', 'players'], ['*', '/mc/servers/:id/players/*', 'mc', 'players'], ['*', '/mc/servers/:id/whitelist', 'mc', 'players'], ['*', '/mc/servers/:id/ops', 'mc', 'players'], ['*', '/mc/servers/:id/ban', 'mc', 'players'], ['*', '/mc/servers/:id/kick', 'mc', 'players'],
  ['GET', '/mc/servers/:id/backups', 'mc', 'backups'], ['POST', '/mc/servers/:id/backups', 'mc', 'backups'], ['POST', '/mc/servers/:id/backups/restore', 'mc', 'backups'],
  ['GET', '/mc/servers/:id/backups/:file/download', 'mc', 'backups'], ['DELETE', '/mc/servers/:id/backups/:file', 'mc', 'backups'], ['GET', '/mc/servers/:id/worlds/:name/download', 'mc', 'backups'],
  ['*', '/mc/servers/:id/files', 'mc', 'files'], ['*', '/mc/servers/:id/files/*', 'mc', 'files'],
  // Spiele-Server (Erweiterung „Spiele-Server“): /games/:id/:command startet, stoppt, startet neu …
  ...['start', 'stop', 'restart', 'kill', 'monitor'].map((c) => ['POST', `/games/:id/${c}`, 'game', 'start-stop']), ['GET', '/games/:id', 'game', 'start-stop'], ['GET', '/games/:id/quick', 'game', 'start-stop'],
  ['GET', '/games/:id/console', 'game', 'console'], ['GET', '/games/:id/commands', 'game', 'console'], ['GET', '/games/:id/details', 'game', 'console'], ['POST', '/games/:id/send', 'game', 'console'],
  ['GET', '/games/:id/players', 'game', 'players'],
  ['GET', '/games/:id/backups', 'game', 'backups'], ['POST', '/games/:id/backups/:file/restore', 'game', 'backups'], ['DELETE', '/games/:id/backups/:file', 'game', 'backups'],
  // Webserver, Datenbanken, Apps
  ...['web', 'dbs', 'apps'].flatMap((k) => [['POST', `/${k}/:id/start`, null, 'start-stop'], ['POST', `/${k}/:id/stop`, null, 'start-stop'], ['POST', `/${k}/:id/restart`, null, 'start-stop'], ['POST', `/${k}/:id/kill`, null, 'start-stop'], ['GET', `/${k}/:id`, null, 'start-stop']]),
  ['GET', '/web/:id/logs/:which', null, 'logs'],
  // Protokolle und Verlauf eines Dienstes: /logs/mc:<id>, /logs/app:<id>, /logs/<id>
  ['GET', '/logs/:svc', 'svc', 'logs'], ['GET', '/stats/:svc', 'svc', 'logs'],
];

/**
 * Routes under a service that stay with the admins – even if every area is shared (settings, versions, plugins, market,
 * deleting the service …). Listed on purpose, so the route test can tell "decided" from "forgotten".
 */
const ADMIN_ONLY = [
  'DELETE /mc/servers/:id', 'PUT /mc/servers/:id', 'DELETE /mc/servers/:id/icon', 'PUT /mc/servers/:id/icon', 'POST /mc/servers/:id/gamerules', 'PUT /mc/servers/:id/gamerules',
  'GET /mc/servers/:id/properties', 'PUT /mc/servers/:id/properties', 'POST /mc/servers/:id/version', 'POST /mc/servers/:id/deploy', 'POST /mc/servers/:id/selftest',
  'GET /mc/servers/:id/client-pack', 'GET /mc/servers/:id/client-pack/download', 'GET /mc/servers/:id/hostwerk-plugins', 'GET /mc/servers/:id/live-update', 'PUT /mc/servers/:id/live-update',
  'POST /mc/servers/:id/live-update/bridge', 'POST /mc/servers/:id/live-update/script', 'GET /mc/servers/:id/map', 'POST /mc/servers/:id/map', 'GET /mc/servers/:id/market', 'GET /mc/servers/:id/market-updates',
  'GET /mc/servers/:id/market/:source/:pid', 'POST /mc/servers/:id/market/install', 'GET /mc/servers/:id/modpack/updates', 'POST /mc/servers/:id/modpack/update', 'GET /mc/servers/:id/modrinth', 'POST /mc/servers/:id/modrinth',
  'GET /mc/servers/:id/network', 'POST /mc/servers/:id/network', 'POST /mc/servers/:id/network/lobby', 'DELETE /mc/servers/:id/plugins/:file', 'DELETE /mc/servers/:id/plugins/source', 'PUT /mc/servers/:id/plugins/source',
  'POST /mc/servers/:id/plugins/source/open', 'POST /mc/servers/:id/plugins/source/resume', 'POST /mc/servers/:id/plugins/sources/check', 'POST /mc/servers/:id/plugins/sources/rescan', 'POST /mc/servers/:id/plugins/sources/update',
  'POST /mc/servers/:id/plugins/toggle', 'POST /mc/servers/:id/plugins/update', 'POST /mc/servers/:id/plugins/upload', 'GET /mc/servers/:id/safe-upgrade', 'POST /mc/servers/:id/safe-upgrade', 'GET /mc/servers/:id/safe-upgrade/history',
  'POST /mc/servers/:id/safe-upgrade/check', 'POST /mc/servers/:id/updates/check', 'POST /mc/servers/:id/worlds/:name/reset',
  'POST /games/:id/:command', 'DELETE /games/:id', 'PUT /games/:id', 'GET /games/:id/config', 'PUT /games/:id/config', 'PUT /games/:id/limits', 'PUT /games/:id/quick', 'GET /games/:id/textfile', 'PUT /games/:id/textfile',
  ...['web', 'dbs', 'apps'].flatMap((k) => [`DELETE /${k}/:id`, `PUT /${k}/:id`]),
  'POST /apps/:id/install-deps', 'POST /dbs/:id/password', 'POST /dbs/:id/upgrade', 'GET /dbs/:id/backups', 'POST /dbs/:id/backups', 'POST /dbs/:id/backups/restore', 'GET /dbs/:id/backups/:file/download', 'DELETE /dbs/:id/backups/:file', 'PUT /dbs/:id/backups/config',
  'GET /web/:id/conf', 'PUT /web/:id/conf', 'GET /web/:id/latest', 'GET /web/:id/projects', 'POST /web/:id/test', 'POST /web/:id/upgrade', 'POST /web/:id/vhosts', 'PUT /web/:id/vhosts/:vid', 'DELETE /web/:id/vhosts/:vid', 'DELETE /web/:id/logs/:which',
  'DELETE /logs/:svc',
];

/** Always allowed (exact paths): overview and lists come back filtered; own session and own password. */
const ALWAYS = [
  ['GET', '/overview'], ['GET', '/summary'], ['GET', '/app/ping'], ['GET', '/settings'], ['GET', '/jobs'], ['GET', '/jobs/:id'], ['GET', '/push'], ['GET', '/users/me'],
  ['*', '/live/remote/logout'], ['*', '/users/me/password'], ['*', '/pw/shared/mine'], ['*', '/pw/shared/mine/reveal'],
  // Listen: nur Lesen, Hostwerk filtert sie auf die freigegebenen Dienste
  ['GET', '/mc/servers'], ['GET', '/games'], ['GET', '/web'], ['GET', '/dbs'], ['GET', '/apps'],
];

/** Route template → anchored regular expression; :id is captured, other :params and * match one or more parts. */
function compile(tpl) {
  const keys = [];
  const src = tpl.split('/').map((part) => {
    if (part === '*') return '.+';
    if (part.startsWith(':')) { keys.push(part.slice(1)); return '([^/]+)'; }
    return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { re: new RegExp(`^${src}$`), keys };
}
const COMPILED = MEMBER_ROUTES.map(([method, tpl, kind, area]) => ({ method, tpl, kind, area, ...compile(tpl) }));
const ALWAYS_COMPILED = ALWAYS.map(([method, tpl]) => ({ method, ...compile(tpl) }));

/** Which shared service does a match concern? /logs/mc:<id> → mc:<id>, /logs/app:<id> → apps:<id>, /web/<id> → web:<id> */
function serviceOf(r, params, p, shared) {
  if (r.kind === 'svc') {
    const raw = params.svc || '';
    if (raw.startsWith('mc:')) return `mc:${raw.slice(3)}`;
    if (raw.startsWith('app:')) return `apps:${raw.slice(4)}`;
    return [...shared].find((s) => s.endsWith(`:${raw}`) && /^(web|dbs):/.test(s)) || `web:${raw}`;
  }
  return `${r.kind || p.split('/')[1]}:${params.id}`;
}

/** Which rule answers a request: { always } | { rule, service } | null (nothing for members). Pure, tested. */
function classify(method, p, shared = new Set()) {
  for (const a of ALWAYS_COMPILED) if ((a.method === '*' || a.method === method) && a.re.test(p)) return { always: true };
  for (const r of COMPILED) {
    if (r.method !== '*' && r.method !== method) continue;
    const m = r.re.exec(p); if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return { rule: r, service: serviceOf(r, params, p, shared) };
  }
  return null;
}

/** May a member with these rights make this request? (role admin and local sessions are handled before) */
function memberAllows(u, method, p) {
  const svc = new Set(u.services || []); const areas = new Set(u.areas || []);
  const c = classify(method, p, svc);
  if (!c) return false;
  if (c.always) return true;
  return svc.has(c.service) && areas.has(c.rule.area);
}

class Members {
  constructor(host) { this.host = host; this.ctx = host.ctx; this.t = host.t; }
  get list() { const s = this.ctx.settings.get(); if (!s.users) s.users = []; return s.users; }
  pub(u) { const { passHash, ...rest } = u; return { ...rest, hasPassword: !!passHash }; }
  get(id) { const u = this.list.find((x) => x.id === id); if (!u) throw this.host.error(404, 'User not found'); return u; }
  byName(name) { const n = String(name || '').trim().toLowerCase(); return this.list.find((u) => u.name.toLowerCase() === n && u.enabled !== false) || null; }
  save(b, id = null) {
    const { t } = this;
    const name = String(b.name || '').trim().slice(0, 40);
    if (!/^[\w.@ -]{2,40}$/.test(name)) throw new Error(t('Name: 2–40 characters (letters, digits, dot, @, -, space).'));
    if (name.toLowerCase() === String(this.ctx.remote.cfg.user || 'admin').toLowerCase() && !id) throw new Error(t('This name is the main remote access account.'));
    if (this.list.some((u) => u.name.toLowerCase() === name.toLowerCase() && u.id !== id)) throw new Error(t('Name already taken.'));
    let u = id ? this.get(id) : null;
    if (!u) { u = { id: crypto.randomBytes(4).toString('hex'), created: Date.now() }; this.list.push(u); }
    Object.assign(u, { name, role: b.role === 'admin' ? 'admin' : ROLE_MEMBER, enabled: b.enabled !== false, services: Array.isArray(b.services) ? b.services.filter((x) => /^(mc|game|web|dbs|apps):[\w-]+$/.test(x)).slice(0, 100) : (u.services || []), areas: Array.isArray(b.areas) ? b.areas.filter((x) => AREAS[x]) : (u.areas || ['start-stop', 'console', 'players']), note: String(b.note || '').slice(0, 200) });
    if (typeof b.password === 'string' && b.password) { if (b.password.length < 8) throw new Error(t('Password: at least 8 characters.')); u.passHash = hashPw(b.password); }
    this.ctx.settings.save();
    return this.pub(u);
  }
  remove(id) { const s = this.ctx.settings.get(); s.users = this.list.filter((u) => u.id !== id); this.ctx.settings.save(); if (this.ctx.remote && this.ctx.remote.sessions) for (const [k, v] of this.ctx.remote.sessions) if (v.userId === id) this.ctx.remote.sessions.delete(k); }
  /** Sign-in of a member (called by remote access). */
  login(name, password) { const u = this.byName(name); if (!u || !u.passHash || !checkPw(password, u.passHash)) return null; u.lastLogin = Date.now(); this.ctx.settings.save(); return u; }

  /** May this session make the request? admin/local: yes. Member: only shared services/areas. */
  allowed(req, session) {
    if (!session || !session.userId) return true; // main account or local
    const u = this.list.find((x) => x.id === session.userId);
    if (!u || u.enabled === false) return false;
    if (u.role === 'admin') return true;
    return memberAllows(u, req.method, req.path);
  }
  /** Shrink lists to the shared services (for members). */
  filterOverview(o, session) {
    if (!session || !session.userId) return o;
    const u = this.list.find((x) => x.id === session.userId);
    if (!u || u.role === 'admin') return o;
    const svc = new Set(u.services || []);
    return { ...o, web: (o.web || []).filter((x) => svc.has(`web:${x.id}`)), db: (o.db || []).filter((x) => svc.has(`dbs:${x.id}`)), minecraft: (o.minecraft || []).filter((x) => svc.has(`mc:${x.id}`)), apps: (o.apps || []).filter((x) => svc.has(`apps:${x.id}`)), games: (o.games || []).filter((x) => svc.has(`game:${x.id}`)), live: null, mail: null, tunnels: [], member: { name: u.name, areas: u.areas } };
  }
  services() {
    const { ctx, t } = this; const out = [];
    try {
      for (const s of ctx.minecraft.list()) out.push({ id: `mc:${s.id}`, name: s.name, kind: 'Minecraft' });
      for (const g of (ctx.games ? ctx.games.list() : [])) out.push({ id: `game:${g.id}`, name: g.name, kind: t('Game server') });
      for (const w of ctx.web.list()) out.push({ id: `web:${w.id}`, name: w.name, kind: t('Web server') });
      for (const d of ctx.dbm.list()) out.push({ id: `dbs:${d.id}`, name: d.name, kind: t('Database') });
      for (const a of (ctx.apps ? ctx.apps.list() : [])) out.push({ id: `apps:${a.id}`, name: a.name, kind: 'App' });
    } catch { /* partly available */ }
    return out;
  }
  routes(r) {
    const { t } = this;
    r.get('/users', (req, res) => res.json({ users: this.list.map((u) => this.pub(u)), areas: Object.fromEntries(Object.entries(AREAS).map(([k, v]) => [k, t(v)])), services: this.services(), remoteEnabled: !!this.ctx.remote.cfg.enabled, mainUser: this.ctx.remote.cfg.user || 'admin' }));
    r.post('/users', (req, res) => res.json(this.save(req.body || {})));
    r.put('/users/:id', (req, res) => res.json(this.save(req.body || {}, req.params.id)));
    r.delete('/users/:id', (req, res) => { this.remove(req.params.id); res.json({ ok: true }); });
    r.get('/users/me', (req, res) => { const s = this.ctx.remote.session(req); const u = s && s.userId ? this.list.find((x) => x.id === s.userId) : null; res.json(u ? { ...this.pub(u), main: false } : { name: (s && s.user) || t('local'), role: 'admin', main: true }); });
    r.post('/users/me/password', (req, res) => {
      const s = this.ctx.remote.session(req); const u = s && s.userId ? this.get(s.userId) : null;
      if (!u) throw new Error(t('Only for members in remote access.'));
      const b = req.body || {};
      if (!checkPw(b.oldPassword, u.passHash)) throw new Error(t('Current password is wrong.'));
      if (String(b.password || '').length < 8) throw new Error(t('At least 8 characters.'));
      u.passHash = hashPw(b.password); this.ctx.settings.save(); res.json({ ok: true });
    });
  }
}

module.exports = { Members, AREAS, MEMBER_ROUTES, ADMIN_ONLY, ALWAYS, compile, classify, memberAllows, hashPw, checkPw, ROLE_MEMBER };
