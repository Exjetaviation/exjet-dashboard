import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import RequireAuth from './components/RequireAuth';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Map from './pages/Map';
import Calendar from './pages/Calendar';
import Flights from './pages/Flights';
import FlightDetail from './pages/FlightDetail';
import TripDetail from './pages/TripDetail';
import Crew from './pages/Crew';
import CrewDetail from './pages/CrewDetail';
import Aircraft from './pages/Aircraft';
import AircraftDetail from './pages/AircraftDetail';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import RateCards from './pages/RateCards';
import Quotes from './pages/Quotes';
import Finances from './pages/Finances';
import Maintenance from './pages/Maintenance';
import AssistantPage from './pages/AssistantPage';
import CrewCalendar from './pages/CrewCalendar';
import Scheduling from './pages/Scheduling';
import { supabase } from './lib/supabase';

function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar open={sidebarOpen} />

      <button
        onClick={() => setSidebarOpen(o => !o)}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        style={{
          position: 'fixed', top: '50%', left: sidebarOpen ? '208px' : '0px',
          transform: 'translateY(-50%)', zIndex: 200, width: '20px', height: '48px',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderLeft: sidebarOpen ? '1px solid var(--border)' : 'none',
          borderRadius: '0 6px 6px 0', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: '10px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'left 0.2s ease', padding: 0,
        }}
      >
        {sidebarOpen ? '\u2039' : '\u203a'}
      </button>

      <button
        onClick={() => supabase.auth.signOut()}
        title="Sign out"
        style={{
          position: 'fixed', bottom: '20px', left: sidebarOpen ? '20px' : '12px',
          zIndex: 200, padding: '7px 14px', fontSize: '12px',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: '8px', color: 'var(--text-secondary)', cursor: 'pointer',
          transition: 'left 0.2s ease',
        }}
      >
        Sign out
      </button>

      <main style={{
        marginLeft: sidebarOpen ? '220px' : '0px', flex: 1, padding: '32px',
        minHeight: '100vh', background: 'var(--bg-primary)', overflowX: 'hidden',
        maxWidth: sidebarOpen ? 'calc(100vw - 220px)' : '100vw',
        boxSizing: 'border-box',
        transition: 'margin-left 0.2s ease, max-width 0.2s ease',
      }}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/map" element={<Map />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/flights" element={<Flights />} />
          <Route path="/scheduling" element={<Scheduling />} />
          <Route path="/flights/:id" element={<FlightDetail />} />
          <Route path="/trips/:id" element={<TripDetail />} />
          <Route path="/crew" element={<Crew />} />
          <Route path="/crew/:id" element={<CrewDetail />} />
          <Route path="/aircraft" element={<Aircraft />} />
          <Route path="/aircraft/:tail" element={<AircraftDetail />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/rate-cards" element={<RateCards />} />
          <Route path="/finances" element={<Finances />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/crew-calendar" element={<CrewCalendar />} />
          <Route path="/quotes" element={<Quotes />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<RequireAuth><Dashboard /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}