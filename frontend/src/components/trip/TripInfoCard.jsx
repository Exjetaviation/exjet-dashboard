// Read-only Trip Info panel for the Trip Overview. Renders the fields the trip GET
// already returns (purpose/company_name/contact/rate_name/booked_by) plus tail/type.
const Row = ({ label, children }) => (
  <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
    <span style={{ flex: '0 0 96px', fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', paddingTop: 2 }}>{label}</span>
    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{children || <span style={{ color: 'var(--text-secondary)' }}>—</span>}</span>
  </div>
);

export default function TripInfoCard({ trip, tail, aircraftType, client }) {
  const c = trip?.contact || null;
  const contactLine = c ? [c.name, c.email, c.phone].filter(Boolean).join(' · ') : null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, flex: '1 1 320px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>Trip Info</div>
      <Row label="Aircraft">{[tail, aircraftType].filter(Boolean).join(' · ')}</Row>
      <Row label="Company">{trip?.company_name || client}</Row>
      <Row label="Contact">{contactLine}</Row>
      <Row label="Purpose">{trip?.purpose ? trip.purpose[0].toUpperCase() + trip.purpose.slice(1) : null}</Row>
      <Row label="Rate">{trip?.rate_name}</Row>
      <Row label="Booked by">{trip?.booked_by}</Row>
    </div>
  );
}
