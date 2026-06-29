import { useState } from 'react';
import { apiFetch } from '../lib/api';
import AirportInput from './AirportInput';

// Mark a leg as DIVERTED — it landed somewhere other than its scheduled arrival, so the
// scheduled flight is incomplete. Shared by the calendar leg popover and the flight-detail
// page. Props: leg (LF-shaped: _id.$oid, departure/arrival, dispatch.aircraft.tailNumber),
// onClose(), onSaved().
export default function DivertModal({ leg, currentDivert, onClose, onSaved }) {
  const legId = leg?._id?.$oid;
  const schedArr = (leg?.arrival?.airport || '').toUpperCase();
  const [icao, setIcao] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('diverted'); // 'diverted' (trip continues) | 'cancelled'
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const code = (icao || '').trim().toUpperCase();
  const valid = code.length >= 3 && code !== schedArr;

  const save = async () => {
    if (!legId || !valid) return;
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`/api/adsb/legs/${legId}/divert`, {
        method: 'POST',
        body: JSON.stringify({
          divertedToIcao: code,
          note: note.trim() || null,
          status,
          scheduledDep: leg?.departure?.time ?? null,
          registration: leg?.dispatch?.aircraft?.tailNumber || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (HTTP ${res.status})`);
      }
      onSaved?.(code);
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Could not save the diversion');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!legId) return;
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`/api/adsb/legs/${legId}/divert`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Remove failed (HTTP ${res.status})`);
      }
      onSaved?.(null);
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Could not remove the diversion');
      setSaving(false);
    }
  };

  const lbl = { fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' };
  const inp = { width: '100%', padding: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text-primary)', boxSizing: 'border-box' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', width: '380px', maxWidth: '92vw', boxShadow: '0 12px 48px rgba(0,0,0,0.6)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: 'var(--text-primary)' }}>{currentDivert ? 'Edit diversion' : 'Mark diversion'}</h3>
        <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          {leg?.departure?.airport || '?'} → {schedArr || '?'} · scheduled arrival not reached
        </p>
        {currentDivert && <p style={{ margin: '-10px 0 16px', fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>Currently diverted to {currentDivert}</p>}
        <label style={lbl}>Actually landed at</label>
        <AirportInput value={icao} onChange={setIcao} placeholder="ICAO (e.g. KRSW)" autoFocus inputStyle={inp} />
        <label style={{ ...lbl, marginTop: '12px' }}>Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. medical diversion" style={inp} />
        <div style={{ display: 'flex', gap: '16px', margin: '14px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <label style={{ cursor: 'pointer' }}><input type="radio" checked={status === 'diverted'} onChange={() => setStatus('diverted')} /> Trip continues</label>
          <label style={{ cursor: 'pointer' }}><input type="radio" checked={status === 'cancelled'} onChange={() => setStatus('cancelled')} /> Leg cancelled</label>
        </div>
        {code && code === schedArr && <p style={{ color: 'var(--danger)', fontSize: '12px', margin: '0 0 10px' }}>That's the scheduled arrival — not a diversion.</p>}
        {err && <p style={{ color: 'var(--danger)', fontSize: '12px', margin: '0 0 10px' }}>{err}</p>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
          {currentDivert
            ? <button onClick={remove} disabled={saving} style={{ padding: '8px 12px', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', opacity: saving ? 0.6 : 1 }}>Remove diversion</button>
            : <span />}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ padding: '8px 14px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: '7px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={save} disabled={!valid || saving} style={{ padding: '8px 14px', background: valid ? '#f59e0b' : 'var(--bg-secondary)', color: valid ? '#1a1a1a' : 'var(--text-secondary)', border: 'none', borderRadius: '7px', cursor: valid ? 'pointer' : 'default', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : (currentDivert ? 'Update' : 'Mark diverted')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
