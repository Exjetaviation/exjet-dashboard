import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import RequireAuth from './components/RequireAuth';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Map from './pages/Map';
import ErrorBoundary from './components/ErrorBoundary';
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
import SchedulingTripDetail from './pages/SchedulingTripDetail';
import QuoteEditor from './pages/QuoteEditor';
import NewQuoteRedirect from './pages/NewQuoteRedirect';
import SchedulingTripSheet from './pages/SchedulingTripSheet';
import PersonProfile from './pages/scheduling/PersonProfile';
import FleetAircraftDetail from './pages/fleet/FleetAircraftDetail';
import FleetComponents from './pages/fleet/FleetComponents';

// The existing dashboard: left sidebar + pages, with the global TopNav on top.
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
        {sidebarOpen ? '‹' : '›'}
      </button>

      <main style={{
        marginLeft: sidebarOpen ? '220px' : '0px', flex: 1, padding: '32px',
        minHeight: '100vh', background: 'var(--bg-primary)', overflowX: 'hidden',
        maxWidth: sidebarOpen ? 'calc(100vw - 220px)' : '100vw',
        boxSizing: 'border-box',
        transition: 'margin-left 0.2s ease, max-width 0.2s ease',
      }}>
        <TopNav />
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/map" element={<ErrorBoundary label="Fleet Map"><Map /></ErrorBoundary>} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/flights" element={<Flights />} />
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

// The Scheduling system as its OWN page — no dashboard sidebar, full width,
// with the global TopNav on top.
function SchedulingApp() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <main style={{ padding: '32px', minHeight: '100vh', boxSizing: 'border-box', overflowX: 'hidden' }}>
        <TopNav />
        <Routes>
          <Route index element={<Scheduling />} />
          <Route path="new" element={<NewQuoteRedirect />} />
          <Route path="quotes/:quoteNo" element={<QuoteEditor />} />
          <Route path="trips/:id" element={<SchedulingTripDetail />} />
          <Route path="trips/:id/sheet" element={<SchedulingTripSheet />} />
          <Route path="people/:id" element={<PersonProfile />} />
          <Route path="aircraft/:tail" element={<FleetAircraftDetail />} />
          <Route path="components" element={<FleetComponents />} />
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
        <Route path="/scheduling/*" element={<RequireAuth><SchedulingApp /></RequireAuth>} />
        <Route path="/*" element={<RequireAuth><Dashboard /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
