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

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <main style={{
          marginLeft: '220px', flex: 1, padding: '32px',
          minHeight: '100vh', background: 'var(--bg-primary)',
          overflowX: 'hidden', maxWidth: 'calc(100vw - 220px)',
          boxSizing: 'border-box',
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
            <Route path="/rate-cards" element={<RateCards />} />
            <Route path="/quotes" element={<Quotes />} />
          </Routes>
        </main>
        <Assistant />
      </div>
    </BrowserRouter>
  );
}
