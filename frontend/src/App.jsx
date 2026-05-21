import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Assistant from './components/Assistant';
import Overview from './pages/Overview';
import Map from './pages/Map';
import Calendar from './pages/Calendar';
import Flights from './pages/Flights';
import FlightDetail from './pages/FlightDetail';
import Crew from './pages/Crew';
import CrewDetail from './pages/CrewDetail';
import Aircraft from './pages/Aircraft';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import RateCards from './pages/RateCards';
import Quotes from './pages/Quotes';
import Finances from './pages/Finances';
import Maintenance from './pages/Maintenance';
import AssistantPage from './pages/AssistantPage';
import CrewCalendar from './pages/CrewCalendar';
export default function App() {



  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <BrowserRouter>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        
        <Sidebar open={sidebarOpen} />
        
        {/* Toggle button */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          style={{
            position: 'fixed',
            top: '50%',
            left: sidebarOpen ? '208px' : '0px',
            transform: 'translateY(-50%)',
            zIndex: 200,
            width: '20px',
            height: '48px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderLeft: sidebarOpen ? '1px solid var(--border)' : 'none',
            borderRadius: sidebarOpen ? '0 6px 6px 0' : '0 6px 6px 0',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontSize: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'left 0.2s ease',
            padding: 0,
          }}
        >
          {sidebarOpen ? '‹' : '›'}
        </button>

        <main style={{
          marginLeft: sidebarOpen ? '220px' : '0px',
          flex: 1,
          padding: '32px',
          minHeight: '100vh',
          background: 'var(--bg-primary)',
          overflowX: 'hidden',
          maxWidth: sidebarOpen ? 'calc(100vw - 220px)' : '100vw',
          boxSizing: 'border-box',
          transition: 'margin-left 0.2s ease, max-width 0.2s ease',
        }}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/map" element={<Map />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/flights" element={<Flights />} />
            <Route path="/flights/:id" element={<FlightDetail />} />
            <Route path="/crew" element={<Crew />} />
            <Route path="/crew/:id" element={<CrewDetail />} />
            <Route path="/aircraft" element={<Aircraft />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/finances" element={<Finances />} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/crew-calendar" element={<CrewCalendar />} />
          </Routes>
        </main>
        <Assistant />
      </div>
    </BrowserRouter>
  );
}