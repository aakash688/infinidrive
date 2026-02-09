import { createSignal, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import api from '../services/api';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = createSignal<any>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    if (!api.token) {
      navigate('/');
      return;
    }

    try {
      const data = await api.getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div style={{ padding: '40px', 'max-width': '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '30px' }}>
        <h1>Dashboard</h1>
        <nav style={{ display: 'flex', gap: '15px' }}>
          <a href="/files" style={{ color: '#007bff', 'text-decoration': 'none' }}>Files</a>
          <a href="/community" style={{ color: '#007bff', 'text-decoration': 'none' }}>Community</a>
          <a href="/settings" style={{ color: '#007bff', 'text-decoration': 'none' }}>Settings</a>
          <button
            onClick={async () => {
              await api.logout();
              api.setToken(null);
              navigate('/');
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
            Logout
          </button>
        </nav>
      </div>

      <Show when={!loading() && stats()} fallback={<div>Loading...</div>}>
        <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', 'margin-bottom': '30px' }}>
          <div style={{ 
            background: 'white', 
            padding: '20px', 
            'border-radius': '8px',
            'box-shadow': '0 2px 10px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ 'margin-bottom': '10px', color: '#666' }}>Total Files</h3>
            <div style={{ 'font-size': '32px', 'font-weight': 'bold' }}>{stats()?.total_files || 0}</div>
          </div>

          <div style={{ 
            background: 'white', 
            padding: '20px', 
            'border-radius': '8px',
            'box-shadow': '0 2px 10px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ 'margin-bottom': '10px', color: '#666' }}>Total Storage</h3>
            <div style={{ 'font-size': '32px', 'font-weight': 'bold' }}>
              {formatBytes(stats()?.total_size || 0)}
            </div>
          </div>

          <div style={{ 
            background: 'white', 
            padding: '20px', 
            'border-radius': '8px',
            'box-shadow': '0 2px 10px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ 'margin-bottom': '10px', color: '#666' }}>Devices</h3>
            <div style={{ 'font-size': '32px', 'font-weight': 'bold' }}>{stats()?.total_devices || 0}</div>
          </div>

          <div style={{ 
            background: 'white', 
            padding: '20px', 
            'border-radius': '8px',
            'box-shadow': '0 2px 10px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ 'margin-bottom': '10px', color: '#666' }}>Active Bots</h3>
            <div style={{ 'font-size': '32px', 'font-weight': 'bold' }}>{stats()?.total_bots || 0}</div>
          </div>
        </div>

        <div style={{ 
          background: 'white', 
          padding: '30px', 
          'border-radius': '8px',
          'box-shadow': '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ 'margin-bottom': '20px' }}>Recent Files</h2>
          {stats()?.recent_files?.length > 0 ? (
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
              {stats().recent_files.map((file: any) => (
                <div key={file.file_id} style={{
                  padding: '15px',
                  border: '1px solid #ddd',
                  'border-radius': '4px',
                  display: 'flex',
                  'justify-content': 'space-between',
                  'align-items': 'center'
                }}>
                  <div>
                    <strong>{file.file_name}</strong>
                    <div style={{ 'font-size': '12px', color: '#666' }}>
                      {formatBytes(file.file_size)}
                    </div>
                  </div>
                  <a
                    href={api.getStreamUrl(file.file_id)}
                    target="_blank"
                    style={{
                      padding: '5px 15px',
                      background: '#007bff',
                      color: 'white',
                      'text-decoration': 'none',
                      'border-radius': '4px'
                    }}
                  >
                    View
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#999' }}>No files yet. Upload your first file!</p>
          )}
        </div>
      </Show>
    </div>
  );
}
