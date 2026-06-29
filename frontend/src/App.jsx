import { BrowserRouter, Routes, Route } from 'react-router-dom';
import RequireAuth from './components/RequireAuth';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Map from './pages/Map';
import ErrorBoundary from './components/ErrorBoundary';
import AppShell from './components/AppShell';
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

// The existing dashboard: sidebar (desktop) / icon-rail (tablet) / bottom bar (phone).
function Dashboard() {
  return (
    <AppShell withSidebar>
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
    </AppShell>
  );
}

// The Scheduling system as its OWN shell — full width, no dashboard sidebar.
function SchedulingApp() {
  return (
    <AppShell>
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
    </AppShell>
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
