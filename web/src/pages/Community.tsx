import { createSignal, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import api from '../services/api';

export default function Community() {
  const navigate = useNavigate();
  const [files, setFiles] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [search, setSearch] = createSignal('');
  const [category, setCategory] = createSignal<string>('');

  onMount(async () => {
    if (!api.token) {
      navigate('/');
      return;
    }

    await loadFiles();
  });

  const loadFiles = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search()) params.q = search();
      if (category()) params.category = category();
      
      const response = await api.listCommunityFiles(params);
      setFiles(response.files);
    } catch (err) {
      console.error('Failed to load community files:', err);
    } finally {
      setLoading(false);
    }
  };

  const forkFile = async (fileId: string) => {
    try {
      await api.forkFile(fileId);
      alert('File forked successfully!');
      await loadFiles();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to fork file');
    }
  };

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
        <h1>Community Files</h1>
        <nav>
          <a href="/dashboard" style={{ color: '#007bff', 'text-decoration': 'none', 'margin-right': '15px' }}>Dashboard</a>
          <a href="/files" style={{ color: '#007bff', 'text-decoration': 'none', 'margin-right': '15px' }}>Files</a>
          <a href="/settings" style={{ color: '#007bff', 'text-decoration': 'none' }}>Settings</a>
        </nav>
      </div>

      <div style={{ 
        background: 'white', 
        padding: '20px', 
        'border-radius': '8px',
        'box-shadow': '0 2px 10px rgba(0,0,0,0.1)',
        'margin-bottom': '20px'
      }}>
        <div style={{ display: 'flex', gap: '10px', 'margin-bottom': '15px' }}>
          <input
            type="text"
            placeholder="Search files..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            style={{
              flex: 1,
              padding: '10px',
              border: '1px solid #ddd',
              'border-radius': '4px'
            }}
          />
          <select
            value={category()}
            onChange={(e) => setCategory(e.currentTarget.value)}
            style={{
              padding: '10px',
              border: '1px solid #ddd',
              'border-radius': '4px'
            }}
          >
            <option value="">All Categories</option>
            <option value="video">Videos</option>
            <option value="image">Images</option>
            <option value="document">Documents</option>
            <option value="audio">Audio</option>
            <option value="other">Other</option>
          </select>
          <button
            onClick={loadFiles}
            style={{
              padding: '10px 20px',
              background: '#007bff',
              color: 'white',
              border: 'none',
              'border-radius': '4px',
              cursor: 'pointer'
            }}
          >
            Search
          </button>
        </div>
      </div>

      {loading() ? (
        <div>Loading...</div>
      ) : files().length === 0 ? (
        <div style={{ 
          background: 'white', 
          padding: '40px', 
          'border-radius': '8px',
          'box-shadow': '0 2px 10px rgba(0,0,0,0.1)',
          'text-align': 'center',
          color: '#999'
        }}>
          No public files found.
        </div>
      ) : (
        <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
          {files().map((file) => (
            <div key={file.file_id} style={{
              background: 'white',
              padding: '20px',
              'border-radius': '8px',
              'box-shadow': '0 2px 10px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{ 'margin-bottom': '10px' }}>{file.public_title || file.file_name}</h3>
              <div style={{ 'font-size': '12px', color: '#666', 'margin-bottom': '10px' }}>
                {formatBytes(file.file_size)} • {file.view_count} views • {file.fork_count} forks
              </div>
              <div style={{ 'font-size': '12px', color: '#999', 'margin-bottom': '15px' }}>
                By {file.owner_name || 'Unknown'}
              </div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <a
                  href={api.getStreamUrl(file.file_id)}
                  target="_blank"
                  style={{
                    flex: 1,
                    padding: '8px',
                    background: '#007bff',
                    color: 'white',
                    'text-decoration': 'none',
                    'border-radius': '4px',
                    'text-align': 'center',
                    'font-size': '12px'
                  }}
                >
                  View
                </a>
                <button
                  onClick={() => forkFile(file.file_id)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    background: '#28a745',
                    color: 'white',
                    border: 'none',
                    'border-radius': '4px',
                    cursor: 'pointer',
                    'font-size': '12px'
                  }}
                >
                  Fork
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
