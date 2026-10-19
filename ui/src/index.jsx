import { useEffect, useState } from 'react';
import { Users as UsersIcon, Plus, Trash2, Shield, UserCheck, Pencil, RefreshCw, UploadCloud, Download, CheckCircle2, X, FolderSync } from 'lucide-react';
import { get, post, put, del, on, useApi, waitJob, fmtDate } from '@hostwerk/api';
import { Btn, Callout, Empty, Field, Loading, Modal, Seg, Switch, Tabs, PathInput, toast, confirmDialog, promptDialog, InfoTip } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';

/*
 * Team & roles: members with their own sign-in for remote access who only see and control what you share, and team setups
 * from a shared folder or address. The member list also stays where it was: "Go live → Users" (slot "live.tabs").
 */
const MEMBER = 'mitglied'; // stored role value of members (kept for existing data)

function UserDialog({ u, data, onClose, onSaved }) {
  const [f, setF] = useState(u ? { ...u, password: '' } : { name: '', role: MEMBER, password: '', services: [], areas: ['start-stop', 'console', 'players'], enabled: true, note: '' });
  const [busy, setBusy] = useState(false);
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const save = async () => { setBusy(true); try { const r = u ? await put(`/users/${u.id}`, f) : await post('/users', f); toast.success(u ? t('Saved') : t('{name} created', { name: r.name })); onSaved(); } catch (e) { toast.error(e); } setBusy(false); };
  return (
    <Modal title={u ? t('Edit {name}', { name: u.name }) : t('Add user')} onClose={onClose} size="lg" footer={<><Btn onClick={onClose}>Cancel</Btn><Btn className="primary" busy={busy} disabled={!f.name || (!u && f.password.length < 8)} onClick={save}>Save</Btn></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Name (sign-in name)"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label={u ? 'New password (empty = unchanged)' : 'Password (at least 8 characters)'}><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Role" className="span-2"><Seg value={f.role} onChange={(v) => setF({ ...f, role: v })} options={[{ id: MEMBER, label: 'Member – only what is shared', icon: UserCheck }, { id: 'admin', label: 'Admin – everything', icon: Shield }]} /></Field>
          <Field label="Note" className="span-2"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. friend, may restart the survival server" /></Field>
        </div>
        {f.role === MEMBER && (
          <>
            <div><div className="small bold">Shared services</div><div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{data.services.length === 0 ? <span className="small muted">No services yet.</span> : data.services.map((s) => <label key={s.id} className={`chip ${f.services.includes(s.id) ? 'on' : ''}`} style={{ cursor: 'pointer' }}><input type="checkbox" hidden checked={f.services.includes(s.id)} onChange={() => toggle('services', s.id)} />{s.name} <span className="muted tiny">{s.kind}</span></label>)}</div></div>
            <div><div className="small bold">Allowed areas</div><div className="stack" style={{ gap: 4, marginTop: 4 }}>{Object.entries(data.areas).map(([k, l]) => <label key={k} className="check small"><input type="checkbox" checked={f.areas.includes(k)} onChange={() => toggle('areas', k)} />{l}</label>)}</div></div>
          </>
        )}
        <label className="check small"><input type="checkbox" checked={f.enabled !== false} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Active (can sign in)</label>
      </div>
    </Modal>
  );
}

/** Members with roles (same component as the "Users" tab under Go live). */
export function Members() {
  const d = useApi('/users', [], { live: false, poll: true });
  const [edit, setEdit] = useState(undefined);
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
            <div className="grow small" style={{ minWidth: 0 }}><b>{u.name}</b> <span className="badge">{u.role === 'admin' ? t('Admin') : t('Member')}</span>{u.enabled === false && <span className="badge warn">off</span>}
              <div className="tiny muted ellipsis">{[u.role === 'admin' ? t('Everything') : t('{s} service(s) · {a} area(s)', { s: (u.services || []).length, a: (u.areas || []).length }), u.note, u.lastLogin && t('last seen {when}', { when: fmtDate(u.lastLogin) })].filter(Boolean).join(' · ')}</div>
            </div>
            <Switch checked={u.enabled !== false} onChange={async (v) => { try { await put(`/users/${u.id}`, { ...u, enabled: v }); d.reload(); } catch (e) { toast.error(e); } }} />
            <Btn className="xs ghost" icon={Pencil} onClick={() => setEdit(u)}>Edit</Btn>
            <button type="button" className="btn ghost xs icon" title="Delete" aria-label="Delete" onClick={async () => { if (await confirmDialog({ title: t('Delete {name}?', { name: u.name }), confirm: 'Delete', danger: true })) { await del(`/users/${u.id}`); d.reload(); } }}><Trash2 /></button>
          </div>
        ))}
        {users.length === 0 && <Empty icon={UsersIcon} title="No other users yet" text="Add friends or fellow players and only share what they need." />}
      </div>
      {edit !== undefined && <UserDialog u={edit} data={d.data} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); d.reload(); }} />}
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
      <div className="card-body stack" style={{ gap: 10 }}>
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
            <div className="stack" style={{ gap: 3 }}>
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
  const tab = path[0] === 'setup' ? 'setup' : 'members';
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1><UsersIcon /> Team & roles</h1>
          <p>Let friends and colleagues in – each with their own sign-in and only the rights they need.</p>
        </div>
      </div>
      <Tabs value={tab} onChange={(v) => { location.hash = v === 'setup' ? '/ext/team/setup' : '/ext/team'; }} tabs={[{ id: 'members', label: 'Users', icon: UsersIcon }, { id: 'setup', label: 'Team setup', icon: FolderSync }]} />
      {tab === 'members' ? <Members /> : <TeamSetup />}
    </div>
  );
}

export default {
  pages: { main: TeamPage },
  slots: { 'live.tabs': [{ id: 'benutzer', title: 'Users', icon: UsersIcon, Component: Members, order: 70 }] },
};
