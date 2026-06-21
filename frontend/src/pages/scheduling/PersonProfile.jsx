// frontend/src/pages/scheduling/PersonProfile.jsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };
const label = { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const inp = { padding: '7px 10px', fontSize: 13, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box' };
const fullName = (p) => [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
const mask = (v) => (v ? `${'•'.repeat(Math.max(0, String(v).length - 3))}${String(v).slice(-3)}` : '—');

const IDENTITY = [
  ['first_name', 'First name'], ['middle_name', 'Middle name'], ['last_name', 'Last name'],
  ['dob', 'Date of birth', 'date'], ['gender', 'Gender'], ['nationality', 'Nationality'],
  ['citizenship', 'Citizenship'], ['weight_lbs', 'Weight (lb)', 'number'], ['email', 'Email'], ['phone', 'Phone'],
];
const CREDENTIALS = [
  ['passport_number', 'Passport #', 'text', true], ['passport_country', 'Passport country'], ['passport_expiry', 'Passport expiry', 'date'],
  ['green_card_number', 'Green card #', 'text', true], ['green_card_expiry', 'Green card expiry', 'date'],
  ['visa_number', 'Visa #', 'text', true], ['visa_expiry', 'Visa expiry', 'date'],
  ['known_traveler_number', 'Known Traveler #', 'text', true], ['redress_number', 'TSA redress #', 'text', true],
];

export default function PersonProfile() {
  const { id } = useParams();
  const isNew = id === 'new';                // /scheduling/people/new — add a passenger
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(null);   // draft when editing
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/people/${id}`);
      const j = await r.json();
      if (j.person) setData(j); else setError(j.error || 'Failed to load');
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => {
    if (isNew) { setData({ person: {}, trips: [], documents: [], alerts: [] }); setEdit({}); }
    else { load(); }
  }, [isNew, load]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (isNew) {
        const r = await apiFetch('/api/scheduling/people', { method: 'POST', body: JSON.stringify(edit) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Create failed (${r.status})`);
        navigate(`/scheduling/people/${j.person.id}`, { replace: true }); // open the new profile
        return;
      }
      const r = await apiFetch(`/api/scheduling/people/${id}`, { method: 'PATCH', body: JSON.stringify(edit) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
      setEdit(null); await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const uploadDoc = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const data_base64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      const r = await apiFetch(`/api/scheduling/people/${id}/documents`, { method: 'POST',
        body: JSON.stringify({ name: file.name, doc_type: 'passport', content_type: file.type, data_base64 }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Upload failed (${r.status})`); }
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const delDoc = async (docId) => {
    setBusy(true);
    try { await apiFetch(`/api/scheduling/documents/${docId}`, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  if (error && !data) return <div style={{ ...card, color: 'var(--danger)' }}>{error}</div>;
  if (!data) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</p>;
  const { person, trips, documents, alerts } = data;
  const v = edit || person;

  const Field = ([key, lbl, type, secret]) => (
    <div key={key} style={{ marginBottom: 8 }}>
      <div style={label}>{lbl}</div>
      {edit ? (
        <input type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'} value={v[key] ?? ''}
          onChange={(e) => setEdit({ ...v, [key]: e.target.value })} style={inp} />
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
          {secret && person[key] ? (
            <span onClick={() => setReveal((s) => ({ ...s, [key]: !s[key] }))} style={{ cursor: 'pointer' }} title="click to reveal">
              {reveal[key] ? person[key] : mask(person[key])}
            </span>
          ) : (person[key] ?? '—')}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/scheduling?section=people')} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>← Passengers</button>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{isNew ? 'New passenger' : fullName(person)}</h1>
        <div style={{ flex: 1 }} />
        {edit ? (
          <>
            <button onClick={save} disabled={busy} style={{ ...inp, width: 'auto', cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>{busy ? 'Saving…' : isNew ? 'Create passenger' : 'Save'}</button>
            <button onClick={() => { if (isNew) navigate('/scheduling?section=people'); else { setEdit(null); setError(null); } }} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setEdit({ ...person })} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>✎ Edit</button>
        )}
      </div>

      {error && <div style={{ ...card, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
      {alerts?.length > 0 && (
        <div style={{ ...card, marginBottom: 12, borderColor: '#f59e0b55', background: '#f59e0b14' }}>
          {alerts.map((a, i) => <div key={i} style={{ fontSize: 13, color: a.severity === 'red' ? '#ef4444' : '#f59e0b' }}>⚠️ {a.label} {a.reason.replace(/-/g, ' ')}</div>)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div style={card}><div style={{ ...label, marginBottom: 10, color: 'var(--accent)' }}>Identity</div>{IDENTITY.map(Field)}</div>
        <div style={card}><div style={{ ...label, marginBottom: 10, color: '#a855f7' }}>Travel credentials</div>{CREDENTIALS.map(Field)}</div>

        <div style={card}>
          <div style={{ ...label, marginBottom: 10, color: '#a855f7' }}>Documents</div>
          {documents?.length ? documents.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 }}>
              <a href={d.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', flex: 1 }}>📄 {d.name}</a>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.doc_type}</span>
              <button onClick={() => delDoc(d.id)} style={{ ...inp, width: 'auto', padding: '2px 8px', cursor: 'pointer' }}>✕</button>
            </div>
          )) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No documents yet.</p>}
          {isNew ? (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Create the passenger first, then upload documents.</p>
          ) : (
            <label style={{ ...inp, width: 'auto', display: 'inline-block', marginTop: 8, cursor: 'pointer', color: 'var(--accent)' }}>
              ↑ Upload document
              <input type="file" style={{ display: 'none' }} onChange={(e) => uploadDoc(e.target.files?.[0])} />
            </label>
          )}
        </div>

        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>Trip history</div>
          {trips?.length ? trips.map((t) => (
            <div key={t.id} onClick={() => navigate(`/scheduling/trips/${t.ref}`)} style={{ fontSize: 13, padding: '6px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-primary)' }}>{t.route || '—'}</span>
              <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>{t.start ? new Date(t.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}{t.trip_number ? ` · #${t.trip_number}` : ''}</span>
            </div>
          )) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No trips yet.</p>}
        </div>
      </div>
    </div>
  );
}
