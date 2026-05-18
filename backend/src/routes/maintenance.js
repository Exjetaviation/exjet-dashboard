import express from 'express';
import { supabase } from '../services/supabase.js';

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

export default router;
