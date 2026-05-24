import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

const TYPES = ['maintenance', 'aog', 'inspection', 'other'];
const AIRCRAFT = ['N69FP', 'N408JS'];

export default function Maintenance() {
  const [events, setEvents] = useState([]);
  const [form, setForm]     = useState({ aircraft_tail: 'N69FP', title: '', start: '', end: '', type: 'maintenance', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = () => apiFetch('/api/maintenance').then(r=>r.json()).then(d=>setEvents(d.events||[]));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.title || !form.start || !form.end) return alert('Fill in title, start and end');
    setSaving(true);
    await apiFetch('/api/maintenance', {
      method: 'POST',
      body: JSON.stringify({
        aircraft_tail: form.aircraft_tail,
        title: form.title,
        start_time: new Date(form.start).getTime(),
        end_time: new Date(form.end).getTime(),
        type: form.type,
        notes: form.notes,
      }),
    });
    setSaving(false);
    setForm({ aircraft_tail: 'N69FP', title: '', start: '', end: '', type: 'maintenance', notes: '' });
    load();
  };

  const del = async (id) => {
    if (!confirm('Delete this event?')) return;
    await apiFetch(`/api/maintenance/${id}`, { method: 'DELETE' });
    load();
  };

  const typeColor = t => t==='aog'?'#ef4444':t==='maintenance'?'#f59e0b':t==='inspection'?'#4f8ef7':'#a855f7';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Maintenance & Downtime</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>Schedule maintenance windows — they appear on the Operations Calendar</p>
      </div>

      {/* Form */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
        <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 16px' }}>Add Event</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Aircraft</label>
            <select value={form.aircraft_tail} onChange={e=>setForm(f=>({...f,aircraft_tail:e.target.value}))}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px' }}>
              {AIRCRAFT.map(a=><option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Type</label>
            <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px' }}>
              {TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Title</label>
            <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. 100hr Inspection"
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Start</label>
            <input type="datetime-local" value={form.start} onChange={e=>setForm(f=>({...f,start:e.target.value}))}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>End</label>
            <input type="datetime-local" value={form.end} onChange={e=>setForm(f=>({...f,end:e.target.value}))}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Notes (optional)</label>
            <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Additional details..."
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }} />
          </div>
        </div>
        <button onClick={submit} disabled={saving}
          style={{ marginTop: '16px', padding: '10px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
          {saving ? 'Saving...' : 'Add Event'}
        </button>
      </div>

      {/* Events list */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Scheduled Events ({events.length})</p>
        </div>
        {events.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>No maintenance events scheduled</div>
        ) : events.map(ev => (
          <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: typeColor(ev.type), flexShrink: 0 }} />
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)', width: '70px' }}>{ev.aircraft_tail}</span>
            <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>{ev.title}</span>
            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: `${typeColor(ev.type)}22`, color: typeColor(ev.type), border: `1px solid ${typeColor(ev.type)}44` }}>{ev.type}</span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(ev.start_time).toLocaleDateString()} → {new Date(ev.end_time).toLocaleDateString()}</span>
            <button onClick={()=>del(ev.id)} style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', fontSize: '12px', cursor: 'pointer' }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
