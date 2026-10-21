'use strict';
/*
 * Native part of "Team & roles" (SDK 2.7):
 *   provides "users"  – Hostwerk asks users.allowed(req, session) before every remote request and lets members sign in
 *                       through users.login(); without this extension only the main account can use remote access.
 *   provides "team"   – team setups from a shared folder or address.
 *   /api/users …, /api/team … (same addresses as when it was built in)
 *   public: /api/team/invite/<token> – page where an invited member chooses a password (works once, expires)
 */
const { Members, readForm } = require('./members');
const { TeamSetups } = require('./setups');

let setups = null;

/** Small self-contained page for the invitation (no scripts, nothing from the internet). */
function invitePage(host, { title, text, form = false, name = '', error = '' }) {
  const { t } = host;
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const lang = typeof host.lang === 'function' ? host.lang() : 'de';
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #f4f5f9; --card: #fff; --text: #151925; --muted: #5f677c; --line: #d4d8e3; --accent: #5b3fd6; --err: #c42a3c; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a0c11; --card: #12151d; --text: #e7e9f0; --muted: #a3aabd; --line: #2d3446; --accent: #8b74ff; --err: #ff7b88; } }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--text); display: grid; place-items: center; min-height: 100vh; }
main { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px; width: min(400px, calc(100vw - 32px)); box-sizing: border-box; }
h1 { font-size: 20px; margin: 0 0 8px; } p { color: var(--muted); margin: 0 0 16px; }
label { display: block; font-weight: 600; margin: 12px 0 4px; }
input { width: 100%; box-sizing: border-box; min-height: 40px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
input:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
button, a.btn { display: inline-block; margin-top: 18px; min-height: 40px; padding: 8px 18px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.err { color: var(--err); font-weight: 600; }
</style></head><body><main>
<h1>${esc(title)}</h1><p>${esc(text)}</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
${form ? `<form method="post" autocomplete="on">
<input type="text" name="username" value="${esc(name)}" autocomplete="username" hidden>
<label for="pw">${esc(t('Password (at least 8 characters)'))}</label><input id="pw" name="password" type="password" minlength="8" required autocomplete="new-password">
<label for="pw2">${esc(t('Repeat password'))}</label><input id="pw2" name="repeat" type="password" minlength="8" required autocomplete="new-password">
<button type="submit">${esc(t('Save password'))}</button></form>` : `<a class="btn" href="/">${esc(t('Sign in now'))}</a>`}
</main></body></html>`;
}

function activate(host) {
  const members = new Members(host);
  setups = new TeamSetups(host, { timers: !process.env.HW_TEST });
  host.provide('users', members);
  host.provide('team', setups);
  members.routes(host.router);
  setups.routes(host.router);

  // Einladung: öffentlich (ohne Anmeldung) – der Schlüssel im Link ist das Geheimnis, er gilt einmal und läuft ab
  const send = (res, status, html) => {
    res.status(status).set('content-type', 'text/html; charset=utf-8')
      .set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
      .set('cache-control', 'no-store').set('referrer-policy', 'no-referrer').send(html);
  };
  host.publicRouter.get('/team/invite/:token', (req, res) => {
    const u = members.byInvite(req.params.token);
    if (!u) return send(res, 404, invitePage(host, { title: host.t('Invitation expired'), text: host.t('This invitation is no longer valid – ask for a new one.') }));
    return send(res, 200, invitePage(host, { title: host.t('Welcome, {name}', { name: u.name }), text: host.t('Choose your password for Hostwerk. You then sign in with the name “{name}”.', { name: u.name }), form: true, name: u.name }));
  });
  host.publicRouter.post('/team/invite/:token', async (req, res) => {
    const b = await readForm(req);
    const u = members.byInvite(req.params.token);
    try {
      members.acceptInvite(req.params.token, b.password, b.repeat);
      return send(res, 200, invitePage(host, { title: host.t('All set'), text: host.t('Your password is saved. Sign in with the name “{name}”.', { name: u.name }) }));
    } catch (e) {
      if (!u) return send(res, 404, invitePage(host, { title: host.t('Invitation expired'), text: e.message }));
      return send(res, 400, invitePage(host, { title: host.t('Welcome, {name}', { name: u.name }), text: host.t('Choose your password for Hostwerk. You then sign in with the name “{name}”.', { name: u.name }), form: true, name: u.name, error: e.message }));
    }
  });
  host.on('shutdown', () => setups && setups.stop());
}

function deactivate() { if (setups) setups.stop(); setups = null; }

module.exports = { activate, deactivate };
