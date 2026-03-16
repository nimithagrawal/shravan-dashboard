export default function AccessDenied({ reason }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif',
      background: '#F9FAFB', color: '#374151'
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>&#x1F512;</div>
      <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Access Denied</h2>
      <p style={{ color: '#9CA3AF', fontSize: 14 }}>
        {reason || 'Your link is invalid or has been revoked. Contact Vikas.'}
      </p>
    </div>
  );
}
