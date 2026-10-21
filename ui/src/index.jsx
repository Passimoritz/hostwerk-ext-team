import { useEffect, useState } from 'react';
import { Users as UsersIcon, Plus, Trash2, Shield, UserCheck, Pencil, RefreshCw, UploadCloud, Download, CheckCircle2, X, FolderSync, Link2, Copy, History, CalendarClock } from 'lucide-react';
import { get, post, put, del, on, useApi, waitJob, fmtDate } from '@hostwerk/api';
import { Btn, Callout, Empty, Field, Loading, Modal, Seg, Switch, Tabs, PathInput, toast, confirmDialog, promptDialog, InfoTip } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';
import './style.css';

/*
 * Team & roles: members with their own sign-in for remote access who only see and control what you share, and team setups
 * from a shared folder or address. The member list also stays where it was: "Go live → Users" (slot "live.tabs").
 */
const MEMBER = 'mitglied'; // stored role value of members (kept for existing data)
// Datum in Hostwerks Sprache; für <input type="date"> als JJJJ-MM-TT in der Ortszeit
const locale = () => (document.documentElement.lang === 'en' ? 'en-GB' : 'de-DE');
const dateText = (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const dateInput = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function UserDialog({ u, data, onClose, onSaved }) {
  const [f, setF] = useState(u ? { ...u, password: '', until: u.until ? dateInput(u.until) : '' } : { name: '', role: MEMBER, password: '', services: [], areas: ['start-stop', 'console', 'players'], enabled: true, note: '', until: '' });
  const [inviteNew, setInviteNew] = useState(!u);
  const [busy, setBusy] = useState(false);
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  // „Gültig bis“ als Tagesende in der Ortszeit; leer = unbefristet
  const body = () => ({ ...f, until: f.until ? new Date(`${f.until}T23:59:59`).getTime() : null, password: inviteNew && !u ? '' : f.password });
  const save = async () => { setBusy(true); try { const r = u ? await put(`/users/${u.id}`, body()) : await post('/users', body()); toast.success(u ? t('Saved') : t('{name} created', { name: r.name })); onSaved(!u && inviteNew ? r : null); } catch (e) { toast.error(e); } setBusy(false); };
  return (
    <Modal title={u ? t('Edit {name}', { name: u.name }) : t('Add user')} onClose={onClose} size="lg" footer={<><Btn onClick={onClose}>Cancel</Btn><Btn className="primary" busy={busy} disabled={!f.name || (!u && !inviteNew && f.password.length < 8)} onClick={save}>Save</Btn></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Name (sign-in name)"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          {!u && <label className="check small span-2"><input type="checkbox" checked={inviteNew} onChange={(e) => setInviteNew(e.target.checked)} />Invite with a link – the person chooses the password</label>}
          {(u || !inviteNew) && <Field label={u ? 'New password (empty = unchanged)' : 'Password (at least 8 characters)'}><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>}
          <Field label="Rights until (optional)" hint="For helpers for a while: after this day the person can no longer sign in."><input className="input" type="date" min={dateInput(Date.now() + 86400000)} value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field>
          <Field label="Role" className="span-2"><Seg value={f.role} onChange={(v) => setF({ ...f, role: v })} options={[{ id: MEMBER, label: 'Member – only what is shared', icon: UserCheck }, { id: 'admin', label: 'Admin – everything', icon: Shield }]} /></Field>
          <Field label="Note" className="span-2"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. friend, may restart the survival server" /></Field>
        </div>
        {f.role === MEMBER && (
          <>
            <div><div className="small bold">Shared services</div><div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-1)' }}>{data.services.length === 0 ? <span className="small muted">No services yet.</span> : data.services.map((s) => <label key={s.id} className={`chip ${f.services.includes(s.id) ? 'on' : ''}`} style={{ cursor: 'pointer' }}><input type="checkbox" hidden checked={f.services.includes(s.id)} onChange={() => toggle('services', s.id)} />{s.name} <span className="muted tiny">{s.kind}</span></label>)}</div></div>
            <div><div className="small bold">Allowed areas</div><div className="stack" style={{ gap: 'var(--sp-1)', marginTop: 'var(--sp-1)' }}>{Object.entries(data.areas).map(([k, l]) => <label key={k} className="check small"><input type="checkbox" checked={f.areas.includes(k)} onChange={() => toggle('areas', k)} />{l}</label>)}</div></div>
          </>
        )}
        <label className="check small"><input type="checkbox" checked={f.enabled !== false} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Active (can sign in)</label>
      </div>
    </Modal>
  );
}

/** Invitation link instead of passing on a password – works once and expires. */
function InviteDialog({ u, onClose, onDone }) {
  const [hours, setHours] = useState(24);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const create = async () => { setBusy(true); try { setRes(await post(`/users/${u.id}/invite`, { hours })); onDone && onDone(); } catch (e) { toast.error(e); } setBusy(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(res.link); toast.success('Link copied'); } catch { toast.error('Could not copy'); } };
  return (
    <Modal title={t('Invite {name}', { name: u.name })} onClose={onClose} footer={res ? <Btn className="primary" onClick={onClose}>Done</Btn> : <><Btn onClick={onClose}>Cancel</Btn><Btn className="primary" icon={Link2} busy={busy} onClick={create}>Create link</Btn></>}>
      <div className="stack">
        {!res ? (
          <>
            <p className="small muted">{t('{name} opens the link, chooses a password and can sign in right away – you never pass on a password. The link works once.', { name: u.name })}</p>
            <Field label="Valid for">
              <select className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                <option value={1}>{t('1 hour')}</option><option value={24}>{t('1 day')}</option><option value={72}>{t('3 days')}</option><option value={168}>{t('7 days')}</option>
              </select>
            </Field>
          </>
        ) : (
          <>
            {!res.remoteEnabled && <Callout kind="warn" dismissible={false}>Remote access is off – switch it on under Go live → Remote access, otherwise the link does not open.</Callout>}
            <div className="row-tight"><code className="grow team-link">{res.link}</code><button type="button" className="btn ghost xs icon" title="Copy link" aria-label="Copy link" onClick={copy}><Copy size={12} /></button></div>
            <div className="tiny muted">{t('Works once, until {when}.', { when: fmtDate(res.until) })}</div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Who did what: changes by members (from Hostwerk's change log) and refused attempts. */
export function Activity() {
  const d = useApi('/users/activity', [], { live: false, poll: true });
  const [who, setWho] = useState('');
  if (d.error && !d.data) return <div className="card"><Empty icon={History} title="Couldn't load the activity" text={String(d.error.message || d.error)} action={<Btn className="sm" icon={RefreshCw} onClick={() => d.reload()}>Try again</Btn>} /></div>;
  if (!d.data) return <div className="card"><Loading /></div>;
  const names = [...new Set(d.data.items.map((x) => x.user))].sort();
  const items = d.data.items.filter((x) => !who || x.user === who);
  const label = { change: 'Change', denied: 'Refused', expired: 'Rights expired' };
  return (
    <div className="card">
      <div className="card-head"><History size={16} /><h3>Activity</h3><span className="badge">{items.length}</span>
        <InfoTip title="Activity">What members changed (from Hostwerk's change log) and what they tried without permission. Refused attempts are kept here – the last 200.</InfoTip>
        {names.length > 1 && <div className="right"><select className="select sm" value={who} aria-label="Member" onChange={(e) => setWho(e.target.value)}><option value="">All members</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>}
      </div>
      {items.length === 0 ? <Empty icon={History} title="Nothing yet" text="As soon as members change something or try something they may not, it shows up here." /> : items.map((x, i) => (
        <div key={`${x.t}-${i}`} className="list-item">
          <span className={`badge ${x.kind === 'change' ? '' : 'warn'}`}>{t(label[x.kind] || x.kind)}</span>
          <div className="grow small" style={{ minWidth: 0 }}><b>{x.user}</b> <span className="ellipsis">{x.text}</span>{x.device ? <div className="tiny muted">{x.device}</div> : null}</div>
          <span className="tiny muted">{fmtDate(x.t)}</span>
        </div>
      ))}
    </div>
  );
}

/** Members with roles (same component as the "Users" tab under Go live). */
export function Members() {
  const d = useApi('/users', [], { live: false, poll: true });
  const [edit, setEdit] = useState(undefined);
  const [invite, setInvite] = useState(null);
  if (d.error && !d.data) return <div className="card"><Empty icon={UsersIcon} title="Couldn't load the users" text={String(d.error.message || d.error)} action={<Btn className="sm" icon={RefreshCw} onClick={() => d.reload()}>Try again</Btn>} /></div>;
  if (!d.data) return <Loading />;
  const { users, remoteEnabled, mainUser } = d.data;
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><UsersIcon size={16} /><h3>Users</h3><span className="badge">{users.length + 1}</span>
          <InfoTip title="How roles work">Every person signs in to remote access with their own name and password (or passkey). Members only see and control the services and areas you share – for example “start the survival server and manage players”. The change log shows who did what.</InfoTip>
          <div className="right"><Btn className="primary sm" icon={Plus} onClick={() => setEdit(null)}>Add user</Btn></div>
        </div>
        {!remoteEnabled && <div className="card-body"><Callout kind="info" dismissible={false}>Remote access is off – users can only sign in once it is switched on under Go live → Remote access.</Callout></div>}
        <div className="list-item"><div className="ico"><Shield /></div><div className="grow small"><b>{mainUser}</b> <span className="badge">Main account</span><div className="tiny muted">{t('Admin · password and 2FA under Go live → Remote access')}</div></div></div>
        {users.map((u) => (
          <div key={u.id} className="list-item" style={{ opacity: u.enabled === false ? 0.55 : 1 }}>
            <div className="ico">{u.role === 'admin' ? <Shield /> : <UserCheck />}</div>
            <div className="grow small" style={{ minWidth: 0 }}><b>{u.name}</b> <span className="badge">{u.role === 'admin' ? t('Admin') : t('Member')}</span>{u.enabled === false && <span className="badge warn">off</span>}{u.expired ? <span className="badge warn">Expired</span> : u.until ? <span className="badge" title={t('Rights until {when}', { when: fmtDate(u.until) })}><CalendarClock size={11} /> {t('until {when}', { when: dateText(u.until) })}</span> : null}{!u.hasPassword && <span className="badge">{u.invite ? t('Invited') : t('No password yet')}</span>}
              <div className="tiny muted ellipsis">{[u.role === 'admin' ? t('Everything') : t('{s} service(s) · {a} area(s)', { s: (u.services || []).length, a: (u.areas || []).length }), u.note, u.lastLogin && t('last seen {when}', { when: fmtDate(u.lastLogin) })].filter(Boolean).join(' · ')}</div>
            </div>
            <Switch checked={u.enabled !== false} onChange={async (v) => { try { await put(`/users/${u.id}`, { ...u, enabled: v }); d.reload(); } catch (e) { toast.error(e); } }} />
            <Btn className="xs ghost" icon={Link2} onClick={() => setInvite(u)} title={t('Invitation link for {name}', { name: u.name })}>Invite</Btn>
            <Btn className="xs ghost" icon={Pencil} onClick={() => setEdit(u)}>Edit</Btn>
            <button type="button" className="btn ghost xs icon" title={t('Delete {name}', { name: u.name })} aria-label={t('Delete {name}', { name: u.name })} onClick={async () => { if (await confirmDialog({ title: t('Delete {name}?', { name: u.name }), confirm: 'Delete', danger: true })) { await del(`/users/${u.id}`); d.reload(); } }}><Trash2 /></button>
          </div>
        ))}
        {users.length === 0 && <Empty icon={UsersIcon} title="No other users yet" text="Add friends or fellow players and only share what they need." />}
      </div>
      {edit !== undefined && <UserDialog u={edit} data={d.data} onClose={() => setEdit(undefined)} onSaved={(created) => { setEdit(undefined); d.reload(); if (created) setInvite(created); }} />}
      {invite && <InviteDialog u={invite} onClose={() => setInvite(null)} onDone={() => d.reload()} />}
    </div>
  );
}

/** Team setup: get the shared state from a shared folder/address and publish own changes. */
export function TeamSetup() {
  const [s, setS] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => get('/team').then((d) => { setS(d); setF((x) => x || { source: d.source || 'folder', location: d.location || '' }); }).catch((e) => toast.error(e));
  useEffect(() => { load(); return on('team', load); }, []);
  if (!s || !f) return <div className="card"><Loading /></div>;
  const configure = async () => { try { setS(await put('/team', f)); toast.success('Team setup connected'); } catch (e) { toast.error(e); } };
  return (
    <div className="card">
      <div className="card-head"><FolderSync size={16} /><h3>Team setup</h3>{s.source && !s.error && <span className="badge ok">Connected</span>}{s.update && <span className="badge warn">New version</span>}
        <InfoTip title="What is a team setup?">One shared setup for everyone in the team: it lives in a shared folder (OneDrive, network drive, Git repository) or at an address. Hostwerk checks every 15 minutes for changes and asks before taking anything over – it only adds what is missing.</InfoTip>
      </div>
      <div className="card-body stack" style={{ gap: 'var(--sp-3)' }}>
        <Seg value={f.source} onChange={(v) => setF({ ...f, source: v })} options={[{ id: 'folder', label: 'Shared folder' }, { id: 'url', label: 'Address (read only)' }]} />
        {f.source === 'folder'
          ? <Field label="Folder"><PathInput mode="folder" value={f.location} onChange={(v) => setF({ ...f, location: v })} placeholder="C:\Users\…\OneDrive\Team\Hostwerk" /></Field>
          : <Field label="Address of hostwerk-team.json"><input className="input mono" placeholder="https://…/hostwerk-team.json" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Btn className="sm primary" disabled={!f.location} onClick={configure}>Connect</Btn>
          {s.source && <Btn className="sm" icon={RefreshCw} onClick={async () => { try { setS(await post('/team/check')); } catch (e) { toast.error(e); } }}>Check now</Btn>}
          {s.source === 'folder' && <Btn className="sm" icon={UploadCloud} onClick={async () => { const note = await promptDialog({ title: 'Publish my setup for the team', label: 'What changed?', placeholder: 'e.g. added Redis for the shop project' }); if (note === null) return; try { setS(await post('/team/publish', { note })); toast.success('Published – the team gets a note.'); } catch (e) { toast.error(e); } }}>Publish my setup</Btn>}
        </div>
        {s.lastCheck && <div className="tiny muted">{t('Last checked: {when}', { when: fmtDate(s.lastCheck) })}</div>}
        {s.error && <Callout kind="warn" dismissible={false}>{s.error}</Callout>}
        {s.update && (
          <div className="team-update">
            <div className="row"><b className="grow">{s.update.author ? t('New version of the team setup by {name}', { name: s.update.author }) : t('New version of the team setup')}</b><span className="tiny muted">{s.update.exportedAt ? fmtDate(s.update.exportedAt) : ''}</span></div>
            {s.update.note && <div className="small">“{s.update.note}”</div>}
            <div className="stack" style={{ gap: 'var(--sp-1)' }}>
              {s.update.preview.items.filter((i) => !i.exists).map((i, n) => <div key={n} className="row-tight small"><Plus size={13} style={{ color: 'var(--accent-text)' }} />{i.name}</div>)}
              {s.update.preview.items.every((i) => i.exists) && <div className="row-tight small"><CheckCircle2 size={13} style={{ color: 'var(--ok)' }} />{t('You already have all of it.')}</div>}
            </div>
            <div className="row">
              <Btn className="sm primary" icon={Download} busy={busy} onClick={async () => { setBusy(true); try { const r = await post('/team/apply'); await waitJob(r.job); toast.success('Team setup taken over'); } catch (e) { toast.error(e); } setBusy(false); load(); }}>Take over</Btn>
              <Btn className="sm ghost" icon={X} onClick={async () => setS(await post('/team/dismiss'))}>Ignore</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamPage({ path = [] }) {
  const tab = path[0] === 'setup' ? 'setup' : path[0] === 'activity' ? 'activity' : 'members';
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1><UsersIcon /> Team & roles</h1>
          <p>Let friends and colleagues in – each with their own sign-in and only the rights they need.</p>
        </div>
      </div>
      <Tabs value={tab} onChange={(v) => { location.hash = v === 'members' ? '/ext/team' : `/ext/team/${v}`; }} tabs={[{ id: 'members', label: 'Users', icon: UsersIcon }, { id: 'activity', label: 'Activity', icon: History }, { id: 'setup', label: 'Team setup', icon: FolderSync }]} />
      {tab === 'members' ? <Members /> : tab === 'activity' ? <Activity /> : <TeamSetup />}
    </div>
  );
}

export default {
  pages: { main: TeamPage },
  slots: { 'live.tabs': [{ id: 'benutzer', title: 'Users', icon: UsersIcon, Component: Members, order: 70 }] },
};
