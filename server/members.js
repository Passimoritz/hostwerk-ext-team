'use strict';
/*
 * Several users with roles: friends may start "their" Minecraft or game server or manage players – without access to the
 * rest. Each person signs in to remote access with their own name (password, optionally passkey); sign-in itself and
 * passkeys stay in Hostwerk's core, this extension decides what a member may do.
 *   Roles: admin (everything) · member (only shared services and areas)
 *   Rights per member: services = service ids (mc:<id>, game:<id>, web:<id>, dbs:<id>, apps:<id>), areas
 *   (console, players, backups, files, logs, start-stop)
 * Enforced in the API (Hostwerk asks allowed(req, session) before every request); the local app is always admin.
 * Rights can end on a date ("until"); members can be invited with a link that expires instead of passing on a password.
 * Activity: changes from Hostwerk's change log by members plus refused attempts (kept here, the last 200).
 * Data stays where it always was: settings.users (role values "admin" / "mitglied" as before).
 * For other extensions ("users" service, since 1.2): can(memberId, serviceId, area) – "may this member do that?" with the
 * same rules as remote access; byDiscord(id) – member with this Discord user id (e.g. for the Discord bot).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INVITE_HOURS = [1, 24, 72, 168];
const DENIED_KEEP = 200;
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Discord user ids are "snowflakes": 17–20 digits. */
const DISCORD_ID = /^\d{17,20}$/;
/** Service id as in this extension from a kind of Hostwerk.services() / host.services.list() (minecraft → mc:<id> …). */
const KIND_PREFIX = { minecraft: 'mc', mc: 'mc', game: 'game', web: 'web', db: 'dbs', dbs: 'dbs', app: 'apps', apps: 'apps', docker: 'apps' };
function serviceKey(kind, id) { const k = KIND_PREFIX[String(kind || '')]; return k && id != null && String(id) !== '' ? `${k}:${id}` : null; }
/** Rights with an end date: expired = the member can no longer sign in or do anything. */
const expired = (u, now = Date.now()) => !!(u && u.until && Number(u.until) <= now);

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
  ['GET', '/mc/servers/:id/backups', 'mc', 'backups'], ['GET', '/mc/servers/:id/nightly-backup', 'mc', 'backups'], ['POST', '/mc/servers/:id/backups', 'mc', 'backups'], ['POST', '/mc/servers/:id/backups/restore', 'mc', 'backups'],
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
  // Hostwerk 2.12/3.0: Minecraft-Protokolle, Absturzberichte, TPS, Datapacks ansehen, Plugin-Formulare, Vorgenerieren ansehen
  ['GET', '/mc/servers/:id/logfiles', 'mc', 'logs'], ['GET', '/mc/servers/:id/logfiles/:file', 'mc', 'logs'], ['GET', '/mc/servers/:id/crash-reports', 'mc', 'logs'], ['GET', '/mc/servers/:id/crash-reports/:file', 'mc', 'logs'],
  ['GET', '/mc/servers/:id/tps', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/datapacks', 'mc', 'start-stop'], ['GET', '/mc/servers/:id/pregen', 'mc', 'start-stop'],
  ['GET', '/mc/servers/:id/plugin-forms', 'mc', 'files'], ['PUT', '/mc/servers/:id/plugin-forms/:form', 'mc', 'files'],
  // Webserver: Auswertung, Gesundheit und PHP-Cache ansehen
  ['GET', '/web/:id/stats', null, 'logs'], ['GET', '/web/:id/health', null, 'logs'], ['POST', '/web/:id/health', null, 'logs'], ['GET', '/web/:id/cache', null, 'logs'],
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
  'POST /mc/servers/:id/safe-upgrade/check', 'PUT /mc/servers/:id/nightly-backup', 'POST /mc/servers/:id/updates/check', 'POST /mc/servers/:id/worlds/:name/reset',
  'POST /games/:id/:command', 'DELETE /games/:id', 'PUT /games/:id', 'GET /games/:id/config', 'PUT /games/:id/config', 'PUT /games/:id/limits', 'PUT /games/:id/quick', 'GET /games/:id/textfile', 'PUT /games/:id/textfile',
  ...['web', 'dbs', 'apps'].flatMap((k) => [`DELETE /${k}/:id`, `PUT /${k}/:id`]),
  'POST /apps/:id/install-deps', 'POST /dbs/:id/password', 'POST /dbs/:id/upgrade', 'GET /dbs/:id/backups', 'POST /dbs/:id/backups', 'POST /dbs/:id/backups/restore', 'GET /dbs/:id/backups/:file/download', 'DELETE /dbs/:id/backups/:file', 'PUT /dbs/:id/backups/config',
  'GET /web/:id/conf', 'PUT /web/:id/conf', 'GET /web/:id/latest', 'GET /web/:id/projects', 'POST /web/:id/test', 'POST /web/:id/upgrade', 'POST /web/:id/vhosts', 'PUT /web/:id/vhosts/:vid', 'DELETE /web/:id/vhosts/:vid', 'DELETE /web/:id/logs/:which',
  'DELETE /logs/:svc',
  // Hostwerk 2.12/3.0: Datapacks ändern, Welten ersetzen, Server kopieren, Vorgenerieren steuern, PHP-Cache leeren, Datenbank-Hauptversion und Tabellen-Sicherungen
  'GET /mc/servers/:id/datapacks-market', 'POST /mc/servers/:id/datapacks-market', 'POST /mc/servers/:id/datapacks/upload', 'PUT /mc/servers/:id/datapacks/:name', 'DELETE /mc/servers/:id/datapacks/:name',
  'POST /mc/servers/:id/worlds/import', 'POST /mc/servers/:id/worlds/upload', 'POST /mc/servers/:id/copy', 'POST /mc/servers/:id/pregen', 'POST /mc/servers/:id/pregen/:action', 'POST /mc/servers/:id/pregen/install',
  'POST /web/:id/cache/reset',
  'GET /dbs/:id/major', 'POST /dbs/:id/major', 'POST /dbs/:id/major/rollback', 'DELETE /dbs/:id/major/previous',
  'GET /dbs/:id/backups/:file/tables', 'POST /dbs/:id/backups/restore-table', 'POST /dbs/:id/backups/upload',
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
  constructor(host) {
    this.host = host; this.ctx = host.ctx; this.t = host.t;
    this.dir = this.ctx.paths && this.ctx.paths.data ? path.join(this.ctx.paths.data, 'team') : null;
    this.denied = this.readDenied();
  }
  readDenied() { try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'denied.json'), 'utf8')); } catch { return []; } }
  /** Refused attempt of a member – noted (the same request at most once a minute), so the owner sees who tried what. */
  noteDenied(u, req) {
    const now = Date.now();
    const last = this.denied[0];
    if (last && last.user === u.name && last.method === req.method && last.path === req.path && now - last.t < 60000) return;
    this.denied.unshift({ t: now, user: u.name, method: req.method, path: String(req.path).slice(0, 200), reason: expired(u, now) ? 'expired' : 'denied' });
    this.denied = this.denied.slice(0, DENIED_KEEP);
    if (!this.dir) return;
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, 'denied.json.tmp'), JSON.stringify(this.denied)); fs.renameSync(path.join(this.dir, 'denied.json.tmp'), path.join(this.dir, 'denied.json')); } catch { /* nur Protokoll */ }
  }
  get list() { const s = this.ctx.settings.get(); if (!s.users) s.users = []; return s.users; }
  pub(u) { const { passHash, invite, ...rest } = u; return { ...rest, hasPassword: !!passHash, expired: expired(u), invite: invite && invite.until > Date.now() ? { until: invite.until } : null }; }
  get(id) { const u = this.list.find((x) => x.id === id); if (!u) throw this.host.error(404, 'User not found'); return u; }
  byName(name) { const n = String(name || '').trim().toLowerCase(); return this.list.find((u) => u.name.toLowerCase() === n && u.enabled !== false) || null; }
  save(b, id = null) {
    const { t } = this;
    const name = String(b.name || '').trim().slice(0, 40);
    if (!/^[\w.@ -]{2,40}$/.test(name)) throw new Error(t('Name: 2–40 characters (letters, digits, dot, @, -, space).'));
    if (name.toLowerCase() === String(this.ctx.remote.cfg.user || 'admin').toLowerCase() && !id) throw new Error(t('This name is the main remote access account.'));
    if (this.list.some((u) => u.name.toLowerCase() === name.toLowerCase() && u.id !== id)) throw new Error(t('Name already taken.'));
    // Befristete Rechte: bis zu diesem Zeitpunkt (Millisekunden oder Datum), leer = unbefristet – vor dem Anlegen prüfen
    let until;
    if (b.until !== undefined) {
      until = b.until === null || b.until === '' ? null : typeof b.until === 'number' ? b.until : Date.parse(String(b.until));
      if (until !== null && !(Number.isFinite(until) && until > Date.now())) throw new Error(t('The end date must be in the future.'));
    }
    // Discord-ID (für den Discord-Bot): leer = keine; eine ID gehört höchstens einem Mitglied
    let discordId;
    if (b.discordId !== undefined) {
      discordId = String(b.discordId || '').trim();
      if (discordId && !DISCORD_ID.test(discordId)) throw new Error(t('Discord ID: 17–20 digits (Discord → Settings → Advanced → Developer mode, then right-click the user → Copy user ID).'));
      if (discordId && this.list.some((x) => x.discordId === discordId && x.id !== id)) throw new Error(t('This Discord ID already belongs to another member.'));
    }
    let u = id ? this.get(id) : null;
    if (!u) { u = { id: crypto.randomBytes(4).toString('hex'), created: Date.now() }; this.list.push(u); }
    Object.assign(u, { name, role: b.role === 'admin' ? 'admin' : ROLE_MEMBER, enabled: b.enabled !== false, services: Array.isArray(b.services) ? b.services.filter((x) => /^(mc|game|web|dbs|apps):[\w-]+$/.test(x)).slice(0, 100) : (u.services || []), areas: Array.isArray(b.areas) ? b.areas.filter((x) => AREAS[x]) : (u.areas || ['start-stop', 'console', 'players']), note: String(b.note || '').slice(0, 200) });
    if (until !== undefined) u.until = until;
    if (discordId !== undefined) { if (discordId) u.discordId = discordId; else delete u.discordId; }
    if (typeof b.password === 'string' && b.password) { if (b.password.length < 8) throw new Error(t('Password: at least 8 characters.')); u.passHash = hashPw(b.password); }
    this.ctx.settings.save();
    return this.pub(u);
  }
  remove(id) { const s = this.ctx.settings.get(); s.users = this.list.filter((u) => u.id !== id); this.ctx.settings.save(); if (this.ctx.remote && this.ctx.remote.sessions) for (const [k, v] of this.ctx.remote.sessions) if (v.userId === id) this.ctx.remote.sessions.delete(k); }
  /** Sign-in of a member (called by remote access). */
  login(name, password) { const u = this.byName(name); if (!u || expired(u) || !u.passHash || !checkPw(password, u.passHash)) return null; u.lastLogin = Date.now(); this.ctx.settings.save(); return u; }

  /**
   * Invitation link instead of passing on a password: the member opens it, chooses a password, done. Only the hash of the
   * token is stored; it works once and expires after hours. Address: remote access with own domain, else its LAN address.
   */
  invite(id, hours = 24) {
    const u = this.get(id);
    const h = INVITE_HOURS.includes(Number(hours)) ? Number(hours) : 24;
    const token = crypto.randomBytes(24).toString('base64url');
    u.invite = { hash: sha(token), until: Date.now() + h * 3600000 };
    this.ctx.settings.save();
    const r = this.ctx.remote && this.ctx.remote.status ? this.ctx.remote.status() : {};
    const base = r.domain ? `https://${r.domain}${r.port && r.port !== 443 ? `:${r.port}` : ''}/` : (r.urls && r.urls[0]) || '/';
    return { link: `${base.replace(/\/$/, '')}/api/team/invite/${token}`, until: u.invite.until, remoteEnabled: !!r.enabled };
  }
  /** The user an invitation token belongs to (valid and not used yet), else null. */
  byInvite(token) {
    const h = sha(token); const now = Date.now();
    return this.list.find((u) => u.invite && u.invite.until > now && u.invite.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(u.invite.hash), Buffer.from(h))) || null;
  }
  acceptInvite(token, password, repeat) {
    const { t } = this;
    const u = this.byInvite(token);
    if (!u) throw Object.assign(new Error(t('This invitation is no longer valid – ask for a new one.')), { status: 404 });
    if (String(password || '').length < 8) throw new Error(t('Password: at least 8 characters.'));
    if (password !== repeat) throw new Error(t('The two passwords are not the same.'));
    u.passHash = hashPw(password); delete u.invite; u.enabled = true;
    this.ctx.settings.save();
    return u;
  }

  /** Who did what: changes by members from Hostwerk's change log plus refused attempts, newest first. */
  activity(limit = 300) {
    const names = new Set(this.list.map((u) => u.name.toLowerCase()));
    let changes = [];
    try { changes = (this.ctx.audit ? this.ctx.audit.list({ limit: 2000 }).items : []).filter((e) => e.user && names.has(String(e.user).toLowerCase())).map((e) => ({ t: e.t, user: e.user, kind: 'change', text: [e.kind, e.target, e.action].filter(Boolean).join(' · '), device: e.device || null })); } catch { /* ohne Änderungs-Protokoll */ }
    const refused = this.denied.map((d) => ({ t: d.t, user: d.user, kind: d.reason, text: `${d.method} ${d.path}` }));
    return [...changes, ...refused].sort((a, b) => b.t - a.t).slice(0, limit);
  }

  /** May this session make the request? admin/local: yes. Member: only shared services/areas. */
  allowed(req, session) {
    if (!session || !session.userId) return true; // main account or local
    const u = this.list.find((x) => x.id === session.userId);
    if (!u || u.enabled === false) return false;
    if (expired(u)) { this.noteDenied(u, req); return false; }
    if (u.role === 'admin') return true;
    const ok = memberAllows(u, req.method, req.path);
    if (!ok) this.noteDenied(u, req);
    return ok;
  }
  /**
   * May this member do this? Same rules as remote access, for other extensions (e.g. the Discord bot):
   *   memberId: id of the member · service: "mc:<id>" or { kind, id } from Hostwerk.services() · area: AREAS key
   * Admin: everything. Member: the service is shared AND the area is allowed. Switched off, expired or unknown: no.
   */
  can(memberId, service, area = 'start-stop') {
    const u = this.list.find((x) => x.id === memberId);
    if (!u || u.enabled === false || expired(u)) return false;
    if (u.role === 'admin') return true;
    const key = typeof service === 'string' ? service : service && serviceKey(service.kind, service.id);
    if (!key || !AREAS[area]) return false;
    return (u.services || []).includes(key) && (u.areas || []).includes(area);
  }
  /** Member with this Discord user id (switched on, not expired) – null if none. */
  byDiscord(discordId) {
    const d = String(discordId || '');
    if (!DISCORD_ID.test(d)) return null;
    const u = this.list.find((x) => x.discordId === d && x.enabled !== false && !expired(x));
    return u ? this.pub(u) : null;
  }
  serviceKey(kind, id) { return serviceKey(kind, id); }
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
    r.post('/users/:id/invite', (req, res) => res.json(this.invite(req.params.id, (req.body || {}).hours)));
    r.delete('/users/:id/invite', (req, res) => { const u = this.get(req.params.id); delete u.invite; this.ctx.settings.save(); res.json(this.pub(u)); });
    r.get('/users/activity', (req, res) => res.json({ items: this.activity() }));
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

/** Read a small form body (the invitation page posts a plain HTML form; Hostwerk itself only parses JSON). */
async function readForm(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && Object.keys(req.body).length) return req.body;
  if (req.readableEnded) return {};
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 4096) break; }
  return Object.fromEntries(new URLSearchParams(raw));
}

module.exports = { Members, readForm, expired, serviceKey, DISCORD_ID, INVITE_HOURS, AREAS, MEMBER_ROUTES, ADMIN_ONLY, ALWAYS, compile, classify, memberAllows, hashPw, checkPw, ROLE_MEMBER };
