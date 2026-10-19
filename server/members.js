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

/** Which service and area does an API request touch? null = not a member-reachable request. Pure, tested. */
const RULES = [
  [/^\/mc\/servers\/([^/]+)\/(start|stop|restart)$/, 'mc', 'start-stop'], [/^\/mc\/servers\/([^/]+)\/(command)$/, 'mc', 'console'], [/^\/mc\/servers\/([^/]+)\/(players|whitelist|ops|ban|kick)/, 'mc', 'players'], [/^\/mc\/servers\/([^/]+)\/(backups?|backup)/, 'mc', 'backups'], [/^\/mc\/servers\/([^/]+)\/(files|file)/, 'mc', 'files'], [/^\/mc\/servers\/([^/]+)$/, 'mc', 'start-stop', 'GET'], [/^\/mc\/servers\/([^/]+)\/(stats|ping|selftest|gamerules|worlds|plugins|updates)/, 'mc', 'start-stop', 'GET'],
  [/^\/games\/([^/]+)\/(start|stop|restart|monitor)$/, 'game', 'start-stop'], [/^\/games\/([^/]+)\/(console|command|details)/, 'game', 'console'], [/^\/games\/([^/]+)\/(backup|backups)/, 'game', 'backups'], [/^\/games\/([^/]+)$/, 'game', 'start-stop', 'GET'],
  [/^\/(web|dbs|apps)\/([^/]+)\/(start|stop|restart)$/, null, 'start-stop'], [/^\/(web|dbs|apps)\/([^/]+)$/, null, 'start-stop', 'GET'],
  [/^\/logs\/(mc:|app:)?([^/]+)$/, null, 'logs', 'GET'], [/^\/stats\/(mc:|app:)?([^/]+)$/, null, 'logs', 'GET'],
];

/** May a member with these rights make this request? (role admin and local sessions are handled before) */
function memberAllows(u, method, p) {
  const svc = new Set(u.services || []); const areas = new Set(u.areas || []);
  // Always allowed: overview (filtered), own session, own shared passwords (the password extension checks each entry)
  if (method === 'GET' && /^\/(overview|summary|app\/ping|settings|discord|jobs|push|users\/me)/.test(p)) return true;
  if (/^\/(live\/remote\/logout|users\/me\/password)/.test(p)) return true;
  if (/^\/pw\/shared\/mine(\/reveal)?$/.test(p)) return true;
  for (const [re, kind, area, onlyMethod] of RULES) {
    const x = p.match(re); if (!x) continue;
    if (onlyMethod && method !== onlyMethod) continue;
    let id;
    if (kind) id = `${kind}:${x[1]}`; else if (/^\/(web|dbs|apps)/.test(p)) id = `${x[1]}:${x[2]}`; else id = `${x[1] ? x[1].replace(':', '') : ''}:${x[2]}`.replace(/^:/, '');
    if (!kind && /^\/(logs|stats)\//.test(p)) { const raw = x[2]; id = x[1] === 'mc:' ? `mc:${raw}` : x[1] === 'app:' ? `apps:${raw}` : [...svc].find((s) => s.endsWith(`:${raw}`)) || `web:${raw}`; }
    return svc.has(id) && areas.has(area);
  }
  return method === 'GET' && /^\/(mc\/servers|games|web|dbs|apps)$/.test(p); // lists: yes (filtered)
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

module.exports = { Members, AREAS, RULES, memberAllows, hashPw, checkPw, ROLE_MEMBER };
