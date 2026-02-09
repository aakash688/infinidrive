import { createSignal, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import api from '../services/api';

export default function Settings() {
  const navigate = useNavigate();
  const [bots, setBots] = createSignal<any[]>([]);
  const [devices, setDevices] = createSignal<any[]>([]);

  onMount(async () => {
    if (!api.token) {
      navigate('/');
      return;
    }

    try {
      const [botsRes, devicesRes] = await Promise.all([
        api.listBots(),
        api.listDevices()
      ]);
      setBots(botsRes.bots);
      setDevices(devicesRes.devices);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  });

  return (
    <div style={{ padding: '40px', 'max-width': '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '30px' }}>
        <h1>Settings</h1>
        <nav>
          <a href="/dashboard" style={{ color: '#007bff', 'text-decoration': 'none', 'margin-right': '15px' }}>Dashboard</a>
          <a href="/files" style={{ color: '#007bff', 'text-decoration': 'none', 'margin-right': '15px' }}>Files</a>
          <a href="/community" style={{ color: '#007bff', 'text-decoration': 'none' }}>Community</a>
        </nav>
      </div>

      <div style={{ display: 'grid', gap: '20px' }}>
        <div style={{ 
          background: 'white', 
          padding: '30px', 
          'border-radius': '8px',
          'box-shadow': '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ 'margin-bottom': '20px' }}>Bots</h2>
          {bots().length === 0 ? (
            <p style={{ color: '#999' }}>No bots configured. <a href="/setup">Add a bot</a></p>
          ) : (
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
              {bots().map((bot) => (
                <div key={bot.bot_id} style={{
                  padding: '15px',
                  border: '1px solid #ddd',
                  'border-radius': '4px',
                  display: 'flex',
                  'justify-content': 'space-between',
                  'align-items': 'center'
                }}>
                  <div>
                    <strong>{bot.bot_username || 'Unknown'}</strong>
                    <div style={{ 'font-size': '12px', color: '#666' }}>
                      Status: {bot.health_status}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm(`Are you sure you want to remove bot "${bot.bot_username || 'Unknown'}"?`)) {
                        return;
                      }
                      
                      try {
                        const result = await api.removeBot(bot.bot_id);
                        console.log('Remove bot result:', result);
                        
                        // Reload bots list
                        const response = await api.listBots();
                        setBots(response.bots);
                        
                        alert('Bot removed successfully');
                      } catch (err) {
                        console.error('Remove bot error:', err);
                        alert(err instanceof Error ? err.message : 'Failed to remove bot. Please check the console for details.');
                      }
                    }}
                    style={{
                      padding: '5px 15px',
                      background: '#dc3545',
                      color: 'white',
                      border: 'none',
                      'border-radius': '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ 
          background: 'white', 
          padding: '30px', 
          'border-radius': '8px',
          'box-shadow': '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ 'margin-bottom': '20px' }}>Devices</h2>
          {devices().length === 0 ? (
            <p style={{ color: '#999' }}>No devices registered yet.</p>
          ) : (
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
              {devices().map((device) => (
                <div key={device.device_id} style={{
                  padding: '15px',
                  border: '1px solid #ddd',
                  'border-radius': '4px'
                }}>
                  <strong>{device.device_name}</strong>
                  <div style={{ 'font-size': '12px', color: '#666' }}>
                    {device.device_type} • Last seen: {new Date(device.last_seen * 1000).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
