import express from 'express';
import { supabase } from '../services/supabase.js';
import { getAircraftCalendar } from '../services/levelflight.js';
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('maintenance_events')
      .select('*')
      .order('start_time', { ascending: true });
    if (error) throw error;
    res.json({ events: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { aircraft_tail, title, start_time, end_time, type, notes } = req.body;
    const { data, error } = await supabase
      .from('maintenance_events')
      .insert([{ aircraft_tail, title, start_time, end_time, type: type||'maintenance', notes }])
      .select();
    if (error) throw error;
    res.json({ event: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('maintenance_events')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/sync-workorders', async (req, res) => {
  try {
    const AIRCRAFT = [
      { oid: '673d145b2c00002200f03411', tail: 'N69FP' },
      { oid: '69a0fae31c00002a00611199', tail: 'N408JS' }
    ];
    const now = Date.now();
    const start = now - (90 * 24 * 60 * 60 * 1000);
    const end = now + (90 * 24 * 60 * 60 * 1000);
    let synced = 0;

    for (const ac of AIRCRAFT) {
      const data = await getAircraftCalendar(ac.oid, start, end);
      const workOrders = data.workOrders || [];
      
      for (const wo of workOrders) {
        if (wo.completed) continue; // skip completed work orders
        const event = {
          id: wo._id?.$oid || `wo-${wo.name}`,
          aircraft_tail: ac.tail,
          title: wo.name,
          start_time: wo.start || now,
          end_time: wo.end || wo.proposedEnd || (now + 7 * 24 * 60 * 60 * 1000),
          type: 'maintenance',
          notes: `Airport: ${wo.airport || 'Unknown'} | Work Order from LevelFlight`
        };
        await supabase.from('maintenance_events').upsert(event, { onConflict: 'id' });
        synced++;
      }
    }
    res.json({ success: true, synced });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
export default router;
