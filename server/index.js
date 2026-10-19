'use strict';
/*
 * Native part of "Team & roles" (SDK 2.7):
 *   provides "users"  – Hostwerk asks users.allowed(req, session) before every remote request and lets members sign in
 *                       through users.login(); without this extension only the main account can use remote access.
 *   provides "team"   – team setups from a shared folder or address.
 *   /api/users …, /api/team … (same addresses as when it was built in)
 */
const { Members } = require('./members');
const { TeamSetups } = require('./setups');

let setups = null;

function activate(host) {
  const members = new Members(host);
  setups = new TeamSetups(host, { timers: !process.env.HW_TEST });
  host.provide('users', members);
  host.provide('team', setups);
  members.routes(host.router);
  setups.routes(host.router);
  host.on('shutdown', () => setups && setups.stop());
}

function deactivate() { if (setups) setups.stop(); setups = null; }

module.exports = { activate, deactivate };
