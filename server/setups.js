'use strict';
/*
 * Team setups: a shared Hostwerk setup from a shared folder (OneDrive, network drive, Git repository) or from an address
 * (e.g. the raw link of a gist). Checks regularly for a new version and asks whether to take it over. Publishing writes the
 * own setup into the folder. Uses Hostwerk's setup export/import (ctx.profile) – only missing things are created.
 * Data stays where it always was: settings.team.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'hostwerk-team.json';

class TeamSetups {
  constructor(host, { timers = true } = {}) {
    this.host = host; this.ctx = host.ctx; this.t = host.t;
    const s = this.ctx.settings.get();
    if (!s.team) s.team = { source: null, location: '', appliedHash: null, lastHash: null, lastCheck: null, error: null };
    this.pending = null;
    this.timers = [];
    if (timers) {
      this.timers.push(setTimeout(() => this.check().catch(() => {}), 60000));
      this.timers.push(setInterval(() => this.check().catch(() => {}), 15 * 60 * 1000));
      for (const x of this.timers) if (x.unref) x.unref();
    }
  }
  stop() { for (const x of this.timers) { clearTimeout(x); clearInterval(x); } }
  get cfg() { return this.ctx.settings.get().team; }

  async fetch() {
    const { t } = this;
    const c = this.cfg;
    if (!c.source || !c.location) throw new Error(t('No team setup connected.'));
    let text;
    if (c.source === 'folder') {
      const f = path.join(c.location, FILE);
      if (!fs.existsSync(f)) throw new Error(t('There is no {file} in the folder yet.', { file: FILE }));
      text = fs.readFileSync(f, 'utf8');
    } else {
      const r = await fetch(c.location, { signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
      if (!r.ok) throw new Error(t('The address answers with {status}', { status: r.status }));
      text = await r.text();
    }
    const profile = JSON.parse(text);
    if (profile.hostwerkProfile !== 1) throw new Error(t('The file is not a Hostwerk setup.'));
    return { profile, hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
  }

  async check() {
    const c = this.cfg;
    if (!c.source) return this.state();
    try {
      const { profile, hash } = await this.fetch();
      c.lastCheck = Date.now();
      c.error = null;
      const isNew = hash !== c.appliedHash;
      if (isNew && hash !== c.lastHash) this.host.broadcast({ type: 'toast', kind: 'warn', text: profile.team && profile.team.note ? this.t('New version of the team setup (“{note}”) – take it over under Extensions → Team.', { note: profile.team.note }) : this.t('New version of the team setup – take it over under Extensions → Team.'), href: '/ext/team/setup', hrefLabel: this.t('Open') });
      c.lastHash = hash;
      this.pending = isNew ? { hash, profile } : null;
    } catch (e) {
      c.lastCheck = Date.now();
      c.error = e.message;
    }
    this.ctx.settings.save();
    this.host.broadcast({ type: 'team' });
    return this.state();
  }

  state() {
    const c = this.cfg;
    const p = this.pending && this.pending.profile;
    return {
      source: c.source, location: c.location, lastCheck: c.lastCheck, error: c.error, appliedHash: c.appliedHash,
      update: this.pending ? { hash: this.pending.hash, from: p.from, exportedAt: p.exportedAt, note: p.team && p.team.note, author: p.team && p.team.author, preview: this.ctx.profile.preview(p) } : null,
    };
  }

  async configure(b) {
    const { t } = this;
    const c = this.cfg;
    c.source = ['folder', 'url'].includes(b.source) ? b.source : null;
    c.location = String(b.location || '').trim();
    if (c.source === 'folder' && c.location && !fs.existsSync(c.location)) throw new Error(t('Folder not found.'));
    if (c.source === 'url' && !/^https:\/\//.test(c.location)) throw new Error(t('Please enter an https:// address.'));
    c.lastHash = null;
    this.ctx.settings.save();
    return this.check();
  }

  /** Take over the new version (only creates what is missing – like the normal setup import). */
  apply() {
    if (!this.pending) throw new Error(this.t('There is no new version.'));
    const { hash, profile } = this.pending;
    const job = this.ctx.profile.import(profile);
    job.promise.then(() => { this.cfg.appliedHash = hash; this.pending = null; this.ctx.settings.save(); this.host.broadcast({ type: 'team' }); }).catch(() => {});
    return job;
  }
  dismiss() {
    if (this.pending) { this.cfg.appliedHash = this.pending.hash; this.pending = null; this.ctx.settings.save(); }
    return this.state();
  }

  /** Write the own setup into the shared folder as a new team version. */
  publish(note) {
    const c = this.cfg;
    if (c.source !== 'folder') throw new Error(this.t('Publishing only works with a shared folder (addresses can only be read).'));
    const profile = { ...this.ctx.profile.export(), team: { note: String(note || '').slice(0, 200), author: require('os').userInfo().username } };
    const text = JSON.stringify(profile, null, 2);
    fs.writeFileSync(path.join(c.location, FILE), text);
    c.appliedHash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    c.lastHash = c.appliedHash;
    this.pending = null;
    this.ctx.settings.save();
    return this.state();
  }

  routes(r) {
    r.get('/team', (req, res) => res.json(this.state()));
    r.put('/team', async (req, res) => res.json(await this.configure(req.body || {})));
    r.post('/team/check', async (req, res) => res.json(await this.check()));
    r.post('/team/apply', (req, res) => res.json({ job: this.apply().id }));
    r.post('/team/dismiss', (req, res) => res.json(this.dismiss()));
    r.post('/team/publish', (req, res) => res.json(this.publish((req.body || {}).note)));
  }
}

module.exports = { TeamSetups, FILE };
