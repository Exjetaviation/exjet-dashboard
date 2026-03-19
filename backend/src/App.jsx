import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Overview from './pages/Overview';
import Flights from './pages/Flights';

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <main style={{ marginLeft: '220px', flex: 1, padding: '32px', minHeight: '100vh', background: 'var(--bg-primary)' }}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/flights" element={<Flights />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
