import { useEffect, useId, useState } from 'react';
import { Users as UsersIcon, Plus, Trash2, Shield, UserCheck, Pencil, RefreshCw, UploadCloud, Download, CheckCircle2, X, FolderSync, Link2, Copy, History, CalendarClock, Box, Gamepad2, Globe, Database, Package, Power, SquareTerminal, Archive, FolderOpen, ScrollText, HeartHandshake, Eye, Sparkles, KeyRound, Share2, Search } from 'lucide-react';
import { get, post, put, del, on, useApi, waitJob, fmtDate } from '@hostwerk/api';
import { Btn, Callout, Empty, Field, Loading, Modal, Seg, Switch, Tabs, PathInput, toast, confirmDialog, promptDialog, InfoTip } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';
import './style.css';

/*
 * Team & roles: members with their own sign-in for remote access who only see and control what you share, and team setups
 * from a shared folder or address. The member list also stays where it was: "Go live → Users" (slot "live.tabs").
 * The user dialog has four steps (person, role, access, extras) and a summary; access is a matrix "service × area"
 * (since 1.3 the areas are stored per service – serviceAreas – and the global list is their union for older readers).
 */
const MEMBER = 'mitglied'; // stored role value of members (kept for existing data)
// Datum in Hostwerks Sprache; für <input type="date"> als JJJJ-MM-TT in der Ortszeit
const locale = () => (document.documentElement.lang === 'en' ? 'en-GB' : 'de-DE');
const dateText = (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const dateInput = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const endOfDay = (day) => new Date(`${day}T23:59:59`).getTime();
const NAME_OK = /^[\w.@ -]{2,40}$/;

/* Dienste und Bereiche: Symbol je Art, kurze Spaltennamen und Wörter für die Zusammenfassung */
const kindOf = (id) => String(id).split(':')[0];
const KIND_ICON = { mc: Box, game: Gamepad2, web: Globe, dbs: Database, apps: Package };
const AREA_ORDER = ['start-stop', 'console', 'players', 'backups', 'files', 'logs'];
const AREA_UI = {
  'start-stop': { icon: Power, short: 'Start/stop', verb: 'start and stop' },
  console: { icon: SquareTerminal, short: 'Console', verb: 'console' },
  players: { icon: UsersIcon, short: 'Players', verb: 'manage players' },
  backups: { icon: Archive, short: 'Backups', verb: 'backups' },
  files: { icon: FolderOpen, short: 'Files', verb: 'files' },
  logs: { icon: ScrollText, short: 'Logs', verb: 'read logs' },
};
const DEFAULT_AREAS = ['start-stop', 'console', 'players'];
/** Areas that do something for this service (from the server's route table; without it: all). */
const applicable = (data, id) => (data.kindAreas && data.kindAreas[kindOf(id)]) || AREA_ORDER;

/** Templates: what a typical helper may – applied to the chosen services, or to all matching ones if none is chosen yet. */
const TEMPLATES = [
  { id: 'friend', icon: HeartHandshake, title: 'Friend', text: 'May start Minecraft and game servers and manage players', kinds: ['mc', 'game'], areas: ['start-stop', 'players'] },
  { id: 'helper', icon: Eye, title: 'Helper', text: 'Only reads logs', kinds: null, areas: ['logs'] },
  { id: 'cohost', icon: Sparkles, title: 'Co-host', text: 'Everything for the shared services – settings stay with you', kinds: null, areas: AREA_ORDER },
];

/** "Rights until": quick choices instead of typing a date. */
const UNTIL_QUICK = [{ id: 'none', label: 'Unlimited' }, { id: 'day', label: '1 day', days: 1 }, { id: 'week', label: '1 week', days: 7 }, { id: 'month', label: '1 month', months: 1 }, { id: 'date', label: 'Pick a date', icon: CalendarClock }];
const quickDate = (q) => { const d = new Date(); if (q.months) d.setMonth(d.getMonth() + q.months); else d.setDate(d.getDate() + (q.days || 7)); return dateInput(d.getTime()); };
const INVITE_VALID = [[1, '1 hour'], [24, '1 day'], [72, '3 days'], [168, '7 days']];

/** One numbered step of the dialog. */
function Step({ id, n, title, tip, children }) {
  return (
    <section className="team-step" id={id} aria-labelledby={`${id}-h`}>
      <h3 className="team-step-head" id={`${id}-h`}><span className="team-step-num" aria-hidden="true">{n}</span>{title}{tip}</h3>
      {children}
    </section>
  );
}

/** Large, plain choice cards for the role (native radio buttons – arrow keys work). */
function RoleCards({ value, onChange, name }) {
  const roles = [
    { id: MEMBER, icon: UserCheck, title: 'Member', text: 'Sees and controls only what you share below – for example start one server and manage its players.', points: ['Only the services you choose', 'No settings, no other users'] },
    { id: 'admin', icon: Shield, title: 'Admin', text: 'Can do everything you can – all services, settings, other users and deleting.', points: ['Only for people you fully trust'] },
  ];
  return (
    <div className="team-roles" role="radiogroup" aria-label={t('Role')}>
      {roles.map((r) => (
        <label key={r.id} className={`team-role ${value === r.id ? 'active' : ''}`}>
          <input type="radio" className="sr-only" name={name} value={r.id} checked={value === r.id} onChange={() => onChange(r.id)} />
          <span className="team-role-ico" aria-hidden="true"><r.icon size={18} /></span>
          <span className="team-role-txt">
            <b>{t(r.title)}</b>
            <span className="small">{t(r.text)}</span>
            <span className="team-role-points">{r.points.map((p) => <span key={p} className="tiny">{t(p)}</span>)}</span>
          </span>
          {value === r.id && <CheckCircle2 className="team-role-tick" size={18} aria-hidden="true" />}
        </label>
      ))}
    </div>
  );
}

/** Who may do what per service: one row per service, one column per area ("–" where the area does nothing for it). */
function AccessMatrix({ f, setF, data }) {
  const [q, setQ] = useState('');
  const cols = AREA_ORDER.filter((a) => data.services.some((s) => applicable(data, s.id).includes(a)));
  const list = data.services.filter((s) => !q || `${s.name} ${s.kind}`.toLowerCase().includes(q.trim().toLowerCase()));
  const shared = (id) => f.services.includes(id);
  const areasOf = (id) => (shared(id) && f.serviceAreas[id]) || [];
  const setService = (id, yes) => {
    const per = { ...f.serviceAreas };
    if (yes) per[id] = per[id] && per[id].length ? per[id] : DEFAULT_AREAS.filter((a) => applicable(data, id).includes(a)); else delete per[id];
    setF({ ...f, services: yes ? [...f.services, id] : f.services.filter((x) => x !== id), serviceAreas: per });
  };
  // Ein Bereich an einem noch nicht freigegebenen Dienst gibt den Dienst gleich mit frei
  const setArea = (id, a, yes) => {
    const cur = areasOf(id);
    setF({ ...f, services: shared(id) ? f.services : [...f.services, id], serviceAreas: { ...f.serviceAreas, [id]: yes ? [...cur, a] : cur.filter((x) => x !== a) } });
  };
  // Spaltenkopf: Bereich für alle freigegebenen Dienste an/aus
  const toggleColumn = (a) => {
    const ids = f.services.filter((id) => applicable(data, id).includes(a));
    if (!ids.length) { toast(t('Share a service first.')); return; }
    const all = ids.every((id) => areasOf(id).includes(a));
    const per = { ...f.serviceAreas };
    for (const id of ids) per[id] = all ? areasOf(id).filter((x) => x !== a) : [...new Set([...areasOf(id), a])];
    setF({ ...f, serviceAreas: per });
  };
  if (!data.services.length) return <Empty icon={Box} title="No services yet" text="As soon as you have a Minecraft server, game server, web server, database or app, you can share it here." />;
  return (
    <div className="stack team-access">
      {data.services.length > 8 && (
        <label className="team-search"><Search size={14} aria-hidden="true" /><input className="input sm" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a service …" aria-label={t('Find a service')} /></label>
      )}
      <div className="table-wrap team-matrix-wrap">
        <table className="table team-matrix">
          <caption className="sr-only">{t('Who may do what per service')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('Service')}</th>
              {cols.map((a) => { const A = AREA_UI[a]; return (
                <th key={a} scope="col" className="team-col">
                  <button type="button" className="team-col-btn" title={t('{area} for all shared services – {text}', { area: t(A.short), text: data.areas[a] || '' })} onClick={() => toggleColumn(a)}>
                    <A.icon size={14} aria-hidden="true" /><span>{t(A.short)}</span>
                  </button>
                </th>
              ); })}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const Icon = KIND_ICON[kindOf(s.id)] || Box;
              const yes = shared(s.id); const app = applicable(data, s.id);
              return (
                <tr key={s.id} className={yes ? 'active' : ''} data-no-row-menu="">
                  <th scope="row">
                    <label className="team-svc">
                      <input type="checkbox" checked={yes} onChange={(e) => setService(s.id, e.target.checked)} aria-label={t('Share {name}', { name: s.name })} />
                      <span className="team-svc-ico" aria-hidden="true"><Icon size={15} /></span>
                      <span className="team-svc-name"><b>{s.name}</b><span className="tiny muted">{s.kind}</span></span>
                    </label>
                  </th>
                  {cols.map((a) => (
                    <td key={a} className="team-cell">
                      {app.includes(a)
                        ? <label className="team-tick"><input type="checkbox" checked={areasOf(s.id).includes(a)} onChange={(e) => setArea(s.id, a, e.target.checked)} aria-label={t('{area} – {name}', { area: t(AREA_UI[a].short), name: s.name })} /></label>
                        : <span className="team-na" title={t('Not available for this kind of service')}><span aria-hidden="true">–</span><span className="sr-only">{t('Not available for this kind of service')}</span></span>}
                    </td>
                  ))}
                </tr>
              );
            })}
            {list.length === 0 && <tr data-no-row-menu=""><td colSpan={cols.length + 1} className="small muted">{t('No service matches “{q}”.', { q })}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Plain-language summary before saving: "Paul may: Survival – start and stop, console … until 30 Oct". */
function Summary({ f, data, access, hours, ended }) {
  const name = f.name.trim() || t('This person');
  const svcName = (id) => (data.services.find((s) => s.id === id) || { name: id }).name;
  const verbs = (id) => AREA_ORDER.filter((a) => (f.serviceAreas[id] || []).includes(a) && applicable(data, id).includes(a)).map((a) => t(AREA_UI[a].verb));
  const admin = f.role === 'admin';
  const until = ended ? t('rights have ended') : f.until ? t('until {when}', { when: dateText(endOfDay(f.until)) }) : t('without an end date');
  const signIn = access === 'invite' ? t('gets an invitation link after saving (valid for {time})', { time: t((INVITE_VALID.find((x) => x[0] === hours) || INVITE_VALID[1])[1]) })
    : access === 'password' ? t('signs in with the password you set') : null;
  return (
    <section className="team-summary" aria-label={t('Summary')}>
      <div className="team-summary-head"><CheckCircle2 size={16} aria-hidden="true" /><b>{admin ? t('{name} may do everything – {until}', { name, until }) : t('{name} may – {until}:', { name, until })}</b></div>
      {!admin && (f.services.length === 0
        ? <p className="small team-summary-warn">{t('Nothing shared yet – {name} can sign in but sees nothing.', { name })}</p>
        : <ul className="team-summary-list">{f.services.map((id) => { const v = verbs(id); return <li key={id} className="small"><b>{svcName(id)}</b>: {v.length ? v.join(', ') : t('only see it')}</li>; })}</ul>)}
      <div className="tiny muted">{[f.enabled === false ? t('switched off – cannot sign in for now') : signIn, f.discordId && t('the Discord bot knows this person')].filter(Boolean).join(' · ')}</div>
    </section>
  );
}

function UserDialog({ u, data, onClose, onSaved }) {
  const uid = useId().replace(/:/g, '');
  // Bereiche je Dienst: gespeicherte Aufteilung, sonst (ältere Daten) die globalen Bereiche für jeden freigegebenen Dienst
  const perFrom = (x) => Object.fromEntries((x.services || []).map((id) => [id, (x.serviceAreas && x.serviceAreas[id]) || x.areas || []]));
  const [f, setF] = useState(() => (u
    ? { name: u.name, role: u.role === 'admin' ? 'admin' : MEMBER, password: '', services: u.services || [], serviceAreas: perFrom(u), enabled: u.enabled !== false, note: u.note || '', until: u.until && !u.expired ? dateInput(u.until) : '', discordId: u.discordId || '' }
    : { name: '', role: MEMBER, password: '', services: [], serviceAreas: {}, enabled: true, note: '', until: '', discordId: '' }));
  // abgelaufene Rechte: nichts vorauswählen – erst eine bewusste Wahl lässt die Person wieder herein
  const [untilMode, setUntilMode] = useState(u && u.expired ? 'ended' : f.until ? 'date' : 'none');
  const [access, setAccess] = useState(u ? 'keep' : 'invite');
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const chooseUntil = (id) => {
    setUntilMode(id);
    const q = UNTIL_QUICK.find((x) => x.id === id);
    if (id === 'none') set('until')('');
    else if (id !== 'date') set('until')(quickDate(q));
    else if (!f.until) set('until')(quickDate({ days: 7 }));
  };
  const applyTemplate = (tpl) => {
    const base = f.services.length ? f.services : data.services.map((s) => s.id).filter((id) => !tpl.kinds || tpl.kinds.includes(kindOf(id)));
    const per = {};
    for (const id of base) { const a = tpl.areas.filter((x) => applicable(data, id).includes(x)); if (a.length) per[id] = a; }
    if (!Object.keys(per).length) { toast(t('No matching service for “{name}” yet.', { name: t(tpl.title) })); return; }
    setF({ ...f, role: MEMBER, services: Object.keys(per), serviceAreas: per });
    toast.success(t('Template “{name}” applied – adjust it below if you like.', { name: t(tpl.title) }));
  };
  const nameOk = NAME_OK.test(f.name.trim());
  const pwOk = access !== 'password' || f.password.length >= 8;
  const save = async () => {
    setBusy(true);
    try {
      // nur Bereiche, die beim Dienst etwas bewirken; die globale Liste ist die Vereinigung (für ältere Leser)
      const per = Object.fromEntries(f.services.map((id) => [id, AREA_ORDER.filter((a) => (f.serviceAreas[id] || []).includes(a) && applicable(data, id).includes(a))]));
      const body = { name: f.name.trim(), role: f.role, enabled: f.enabled, note: f.note, discordId: f.discordId, services: f.services, serviceAreas: per, areas: [...new Set(Object.values(per).flat())], until: untilMode === 'ended' ? undefined : f.until ? endOfDay(f.until) : null, password: access === 'password' ? f.password : '' };
      const r = u ? await put(`/users/${u.id}`, body) : await post('/users', body);
      toast.success(u ? t('Saved') : t('{name} created', { name: r.name }));
      let invite = null;
      if (access === 'invite') { try { invite = await post(`/users/${r.id}/invite`, { hours }); } catch (e) { toast.error(e); } }
      onSaved(access === 'invite' ? { user: r, invite } : null);
    } catch (e) { toast.error(e); }
    setBusy(false);
  };
  const steps = [
    { id: 'person', label: 'Person', done: nameOk && pwOk },
    { id: 'role', label: 'Role', done: true },
    { id: 'access', label: 'Access', done: f.role === 'admin' || f.services.length > 0 },
    { id: 'extras', label: 'Extras', done: true },
  ];
  const jump = (id) => { const el = document.getElementById(`${uid}-${id}`); if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
  const accessOptions = u
    ? [{ id: 'keep', label: 'Keep as it is' }, { id: 'password', label: 'New password', icon: KeyRound }, { id: 'invite', label: 'New invitation link', icon: Link2 }]
    : [{ id: 'invite', label: 'Invitation link', icon: Link2 }, { id: 'password', label: 'Set a password', icon: KeyRound }];
  return (
    <Modal title={u ? t('Edit {name}', { name: u.name }) : t('Add user')} subtitle="Who is it, what may they do, and for how long?" onClose={onClose} size="wide"
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn className="primary" icon={access === 'invite' ? Link2 : undefined} busy={busy} disabled={!nameOk || !pwOk} onClick={save}>{access === 'invite' ? (u ? 'Save and create link' : 'Create and invite') : 'Save'}</Btn></>}>
      <div className="team-dialog">
        <nav className="team-steps" aria-label={t('Steps')}>
          {steps.map((s, i) => (
            <button key={s.id} type="button" className={`team-step-link ${s.done ? 'done' : ''}`} onClick={() => jump(s.id)}>
              <span className="team-step-num" aria-hidden="true">{s.done && s.id !== 'extras' ? <CheckCircle2 size={13} /> : i + 1}</span>{t(s.label)}
            </button>
          ))}
        </nav>

        <Step id={`${uid}-person`} n={1} title="Person">
          <div className="form-grid">
            <Field label="Name (sign-in name)" hint={f.name && !nameOk ? 'Name: 2–40 characters (letters, digits, dot, @, -, space).' : undefined}>
              <input className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} autoFocus={!u} autoComplete="off" aria-invalid={f.name && !nameOk ? true : undefined} placeholder="e.g. Paul" />
            </Field>
            <Field label="Can sign in">
              <div className="team-active"><Switch checked={f.enabled !== false} onChange={set('enabled')} label={t('Active (can sign in)')} /><span className="small">{f.enabled !== false ? t('Active') : t('Switched off for now')}</span></div>
            </Field>
            <div className="field span-2">
              <span className="team-label" id={`${uid}-acc`}>{t('Sign-in')} <InfoTip title="Invitation link or password?">With an invitation link the person opens the link, chooses a password and can sign in right away – you never pass on a password. The link works once.</InfoTip></span>
              <div role="group" aria-labelledby={`${uid}-acc`} className="row team-access-row">
                <Seg value={access} onChange={setAccess} options={accessOptions} />
                {access === 'invite' && (
                  <label className="row-tight small">{t('Link valid for')}
                    <select className="select sm" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{INVITE_VALID.map(([h, l]) => <option key={h} value={h}>{t(l)}</option>)}</select>
                  </label>
                )}
              </div>
              {access === 'password' && <input className="input team-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password')(e.target.value)} placeholder={t('At least 8 characters')} aria-label={u ? t('New password') : t('Password (at least 8 characters)')} aria-invalid={f.password && !pwOk ? true : undefined} />}
              {u && access === 'invite' && u.hasPassword && <span className="hint">{t('The old password stays valid until {name} has chosen a new one.', { name: u.name })}</span>}
            </div>
            <div className="field span-2">
              <span className="team-label" id={`${uid}-until`}>{t('Rights until')} <InfoTip title="Rights for a limited time">For helpers for a while: after this day the person can no longer sign in.</InfoTip></span>
              <div role="group" aria-labelledby={`${uid}-until`} className="row team-access-row">
                <Seg value={untilMode} onChange={chooseUntil} options={UNTIL_QUICK} />
                {untilMode === 'date' && <input className="input team-date" type="date" min={dateInput(Date.now() + 86400000)} value={f.until} onChange={(e) => set('until')(e.target.value)} aria-label={t('Last day')} />}
              </div>
              <span className="hint">{untilMode === 'ended' ? t('The rights of {name} ended on {when} – choose a new end or “Unlimited” to let them in again.', { name: u.name, when: dateText(u.until) }) : f.until ? t('Ends after {when}.', { when: dateText(endOfDay(f.until)) }) : t('No end date – until you switch the person off.')}</span>
            </div>
          </div>
        </Step>

        <Step id={`${uid}-role`} n={2} title="Role">
          <RoleCards value={f.role} onChange={set('role')} name={`${uid}-role-radio`} />
        </Step>

        <Step id={`${uid}-access`} n={3} title="Access" tip={<InfoTip title="Services and areas">Tick the services this person may use, then what they may do with each one. A dash means the area does nothing for that kind of service. A click on a column heading switches that area for all shared services.</InfoTip>}>
          {f.role === 'admin'
            ? <Callout kind="info" dismissible={false}>Admins can do everything – there is nothing to share here.</Callout>
            : (
              <>
                {data.services.length > 0 && (
                  <div className="team-templates" role="group" aria-label={t('Templates')}>
                    {TEMPLATES.map((tpl) => (
                      <button key={tpl.id} type="button" className="team-template" onClick={() => applyTemplate(tpl)}>
                        <tpl.icon size={16} aria-hidden="true" /><span><b>{t(tpl.title)}</b><span className="tiny muted">{t(tpl.text)}</span></span>
                      </button>
                    ))}
                  </div>
                )}
                <AccessMatrix f={f} setF={setF} data={data} />
              </>
            )}
        </Step>

        <Step id={`${uid}-extras`} n={4} title="Extras">
          <div className="form-grid">
            <Field label={<>Discord ID (optional) <InfoTip title="Discord ID">With it the Discord bot knows this person and allows exactly what you share here. In Discord: Settings → Advanced → Developer mode, then right-click the person → Copy user ID.</InfoTip></>}>
              <input className="input mono" inputMode="numeric" value={f.discordId} onChange={(e) => set('discordId')(e.target.value.replace(/\D/g, '').slice(0, 20))} placeholder="e.g. 123456789012345678" />
            </Field>
            <Field label="Note">
              <input className="input" value={f.note} maxLength={200} onChange={(e) => set('note')(e.target.value)} placeholder="e.g. friend, may restart the survival server" />
            </Field>
          </div>
        </Step>

        <Summary f={f} data={data} access={access} hours={hours} ended={untilMode === 'ended'} />
      </div>
    </Modal>
  );
}

/** Invitation link instead of passing on a password – works once and expires; with QR code for the phone. */
function InviteDialog({ u, initial = null, onClose, onDone }) {
  const [hours, setHours] = useState(24);
  const [res, setRes] = useState(initial);
  const [busy, setBusy] = useState(false);
  const create = async () => { setBusy(true); try { setRes(await post(`/users/${u.id}/invite`, { hours })); onDone && onDone(); } catch (e) { toast.error(e); } setBusy(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(res.link); toast.success('Link copied'); } catch { toast.error('Could not copy'); } };
  const share = async () => { try { await navigator.share({ title: t('Invitation to Hostwerk'), text: t('Your invitation to Hostwerk – choose your password here:'), url: res.link }); } catch { /* abgebrochen */ } };
  return (
    <Modal title={t('Invite {name}', { name: u.name })} onClose={onClose} size={res && res.qr ? 'wide' : ''} footer={res ? <Btn className="primary" onClick={onClose}>Done</Btn> : <><Btn onClick={onClose}>Cancel</Btn><Btn className="primary" icon={Link2} busy={busy} onClick={create}>Create link</Btn></>}>
      <div className="stack">
        {!res ? (
          <>
            <p className="small muted">{t('{name} opens the link, chooses a password and can sign in right away – you never pass on a password. The link works once.', { name: u.name })}</p>
            <Field label="Valid for">
              <select className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {INVITE_VALID.map(([h, l]) => <option key={h} value={h}>{t(l)}</option>)}
              </select>
            </Field>
          </>
        ) : (
          <div className="team-invite">
            <div className="stack team-invite-main">
              {!res.remoteEnabled && <Callout kind="warn" dismissible={false}>Remote access is off – switch it on under Go live → Remote access, otherwise the link does not open.</Callout>}
              <p className="small">{t('Send {name} this link – by chat, mail or let them scan the QR code with the phone camera.', { name: u.name })}</p>
              <code className="team-link">{res.link}</code>
              <div className="row">
                <Btn className="sm primary" icon={Copy} onClick={copy}>Copy link</Btn>
                {typeof navigator !== 'undefined' && navigator.share && <Btn className="sm" icon={Share2} onClick={share}>Share</Btn>}
              </div>
              <div className="tiny muted">{t('Works once, until {when}.', { when: fmtDate(res.until) })}</div>
            </div>
            {res.qr && (
              <figure className="team-qr">
                <img src={res.qr} width="176" height="176" alt={t('QR code for the invitation link')} />
                <figcaption className="tiny muted">{t('Scan with the phone camera')}</figcaption>
              </figure>
            )}
          </div>
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

/** Round badge with the initials – the same in the list for every person. */
const initials = (name) => String(name || '?').trim().split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
function Avatar({ name, admin }) {
  return <span className={`team-avatar ${admin ? 'team-avatar-admin' : ''}`} aria-hidden="true">{initials(name)}</span>;
}

/** What a member may, short: the shared services as small chips (with the number of areas), at most three. */
function AccessChips({ u, data }) {
  if (u.role === 'admin') return <span className="tiny muted">{t('Everything')}</span>;
  const ids = u.services || [];
  if (!ids.length) return <span className="tiny muted">{t('Nothing shared yet')}</span>;
  const svc = (id) => data.services.find((s) => s.id === id) || { name: id };
  const areas = (id) => (u.serviceAreas && u.serviceAreas[id]) || u.areas || [];
  return (
    <span className="team-chips">
      {ids.slice(0, 3).map((id) => { const Icon = KIND_ICON[kindOf(id)] || Box; const a = areas(id).filter((x) => applicable(data, id).includes(x)); return (
        <span key={id} className="team-chip" title={`${svc(id).name}: ${AREA_ORDER.filter((x) => a.includes(x)).map((x) => t(AREA_UI[x].verb)).join(', ') || t('only see it')}`}>
          <Icon size={11} aria-hidden="true" />{svc(id).name}<span className="muted">· {t(a.length === 1 ? '{n} area' : '{n} areas', { n: a.length })}</span>
        </span>
      ); })}
      {ids.length > 3 && <span className="team-chip muted">{t('+{n} more', { n: ids.length - 3 })}</span>}
    </span>
  );
}

/** Members with roles (same component as the "Users" tab under Go live). */
export function Members() {
  const d = useApi('/users', [], { live: false, poll: true });
  const [edit, setEdit] = useState(undefined);
  const [invite, setInvite] = useState(null); // { u, res }
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
        <div className="list-item team-member" data-no-row-menu="">
          <Avatar name={mainUser} admin />
          <div className="grow small"><div className="team-member-head"><b>{mainUser}</b><span className="badge">Main account</span></div><div className="tiny muted">{t('Admin · password and 2FA under Go live → Remote access')}</div></div>
        </div>
        {users.map((u) => (
          <div key={u.id} className={`list-item team-member ${u.enabled === false ? 'team-member-off' : ''}`}>
            <Avatar name={u.name} admin={u.role === 'admin'} />
            <div className="grow small" style={{ minWidth: 0 }}>
              <div className="team-member-head">
                <b>{u.name}</b>
                <span className={`badge ${u.role === 'admin' ? 'warn' : ''}`}>{u.role === 'admin' ? t('Admin') : t('Member')}</span>
                {u.enabled === false && <span className="badge warn">off</span>}
                {u.expired ? <span className="badge warn">Expired</span> : u.until ? <span className="badge" title={t('Rights until {when}', { when: fmtDate(u.until) })}><CalendarClock size={11} /> {t('until {when}', { when: dateText(u.until) })}</span> : null}
                {!u.hasPassword && <span className="badge">{u.invite ? t('Invited') : t('No password yet')}</span>}
              </div>
              <AccessChips u={u} data={d.data} />
              {(u.note || u.discordId || u.lastLogin) && <div className="tiny muted ellipsis">{[u.note, u.discordId && t('Discord linked'), u.lastLogin && t('last seen {when}', { when: fmtDate(u.lastLogin) })].filter(Boolean).join(' · ')}</div>}
            </div>
            <Switch checked={u.enabled !== false} label={t('{name} can sign in', { name: u.name })} onChange={async (v) => { try { await put(`/users/${u.id}`, { ...u, enabled: v, until: undefined }); d.reload(); } catch (e) { toast.error(e); } }} />
            <Btn className="xs ghost" icon={Link2} onClick={() => setInvite({ u })} title={t('Invitation link for {name}', { name: u.name })}>Invite</Btn>
            <Btn className="xs ghost" icon={Pencil} onClick={() => setEdit(u)} title={t('Edit {name}', { name: u.name })}>Edit</Btn>
            <button type="button" className="btn ghost xs icon" title={t('Delete {name}', { name: u.name })} aria-label={t('Delete {name}', { name: u.name })} onClick={async () => { if (await confirmDialog({ title: t('Delete {name}?', { name: u.name }), confirm: 'Delete', danger: true })) { try { await del(`/users/${u.id}`); d.reload(); } catch (e) { toast.error(e); } } }}><Trash2 /></button>
          </div>
        ))}
        {users.length === 0 && <Empty icon={UsersIcon} title="No other users yet" text="Add friends or fellow players and only share what they need." action={<Btn className="sm primary" icon={Plus} onClick={() => setEdit(null)}>Add user</Btn>} />}
      </div>
      {edit !== undefined && <UserDialog u={edit} data={d.data} onClose={() => setEdit(undefined)} onSaved={(r) => { setEdit(undefined); d.reload(); if (r) setInvite({ u: r.user, res: r.invite }); }} />}
      {invite && <InviteDialog u={invite.u} initial={invite.res || null} onClose={() => setInvite(null)} onDone={() => d.reload()} />}
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
