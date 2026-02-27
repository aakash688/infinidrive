import { createSignal, onMount, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import api from '../services/api';

export default function SharedFile() {
  const params = useParams();
  const [share, setShare] = createSignal<any>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [password, setPassword] = createSignal('');
  const [needsPassword, setNeedsPassword] = createSignal(false);
  const [passwordError, setPasswordError] = createSignal<string | null>(null);
  const [passwordVerified, setPasswordVerified] = createSignal(false);

  onMount(async () => {
    try {
      const data = await api.getShare(params.share_id);
      setShare(data);
      if (data.has_password) {
        setNeedsPassword(true);
        setPasswordVerified(false);
      } else {
        setPasswordVerified(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load share');
    } finally {
      setLoading(false);
    }
  });

  const verifyPassword = async () => {
    if (!password().trim()) {
      setPasswordError('Password is required');
      return false;
    }

    try {
      // Try to access the file with the password to verify it (use a small range request)
      const testUrl = api.getShareStreamUrl(params.share_id, password());
      const response = await fetch(testUrl, { 
        method: 'GET',
        headers: { 'Range': 'bytes=0-0' }
      });
      
      if (response.ok || response.status === 206) {
        setPasswordError(null);
        setPasswordVerified(true);
        return true;
      } else if (response.status === 401) {
        const errorData = await response.json().catch(() => ({ error: 'Invalid password' }));
        setPasswordError(errorData.error || 'Invalid password');
        setPasswordVerified(false);
        return false;
      } else {
        // If it's not 401, the password might be correct but there's another issue
        // For now, assume it's correct if we get past the password check
        setPasswordError(null);
        setPasswordVerified(true);
        return true;
      }
    } catch (err) {
      setPasswordError('Failed to verify password. Please try again.');
      setPasswordVerified(false);
      return false;
    }
  };

  const handleDownload = async (e: MouseEvent) => {
    e.preventDefault();
    
    if (needsPassword() && !passwordVerified()) {
      const verified = await verifyPassword();
      if (!verified) return;
    }
    
    window.location.href = api.getShareDownloadUrl(params.share_id, password() || undefined);
  };

  const handleStream = async (e: MouseEvent) => {
    e.preventDefault();
    
    if (needsPassword() && !passwordVerified()) {
      const verified = await verifyPassword();
      if (!verified) return;
    }
    
    window.open(api.getShareStreamUrl(params.share_id, password() || undefined), '_blank');
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const isStreamable = () => {
    const file = share()?.file;
    if (!file?.mime_type) return false;
    return file.mime_type.startsWith('video/') || file.mime_type.startsWith('audio/') || file.mime_type.startsWith('image/');
  };

  const forkFile = async () => {
    if (!api.token) {
      alert('Please log in to fork files');
      return;
    }
    try {
      await api.forkFile(share()?.file?.file_id);
      alert('File forked to your storage!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fork failed');
    }
  };

  return (
    <div style={{ 
      'min-height': '100vh', 
      display: 'flex', 
      'align-items': 'center', 
      'justify-content': 'center',
      padding: '20px',
    }}>
      <Show when={!loading()} fallback={
        <div style={{ 'text-align': 'center' }}>
          <div style={{ 'font-size': '24px', 'margin-bottom': '10px' }}>Loading...</div>
        </div>
      }>
        <Show when={!error()} fallback={
          <div style={{ 
            background: 'white', 
            padding: '40px', 
            'border-radius': '12px',
            'box-shadow': '0 4px 20px rgba(0,0,0,0.1)',
            'text-align': 'center',
            'max-width': '500px',
          }}>
            <div style={{ 'font-size': '48px', 'margin-bottom': '15px' }}>❌</div>
            <h2 style={{ 'margin-bottom': '10px' }}>Share Not Found</h2>
            <p style={{ color: '#666' }}>
              This share link doesn't exist, has expired, or has reached its download limit.
            </p>
          </div>
        }>
          <div style={{ 
            background: 'white', 
            padding: '40px', 
            'border-radius': '12px',
            'box-shadow': '0 4px 20px rgba(0,0,0,0.1)',
            'max-width': '600px',
            width: '100%',
          }}>
            {/* File Preview Header */}
            <div style={{ 'text-align': 'center', 'margin-bottom': '25px' }}>
              <div style={{ 'font-size': '48px', 'margin-bottom': '10px' }}>
                {share()?.file?.mime_type?.startsWith('video/') ? '🎬' :
                 share()?.file?.mime_type?.startsWith('image/') ? '🖼️' :
                 share()?.file?.mime_type?.startsWith('audio/') ? '🎵' :
                 share()?.file?.mime_type?.startsWith('application/pdf') ? '📄' : '📁'}
              </div>
              <h1 style={{ 'margin-bottom': '10px', 'word-break': 'break-word' }}>
                {share()?.file?.file_name}
              </h1>
              <div style={{ color: '#666', 'margin-bottom': '5px' }}>
                {formatBytes(share()?.file?.file_size || 0)}
                <span style={{ margin: '0 8px' }}>•</span>
                {share()?.file?.mime_type || 'Unknown type'}
              </div>
              {share()?.expires_at && (
                <div style={{ 'font-size': '12px', color: '#999' }}>
                  Expires: {new Date(share().expires_at * 1000).toLocaleString()}
                </div>
              )}
              {share()?.max_downloads && (
                <div style={{ 'font-size': '12px', color: '#999' }}>
                  Downloads: {share().download_count}/{share().max_downloads}
                </div>
              )}
            </div>

            {/* Inline Video/Audio Player */}
            <Show when={isStreamable() && (!needsPassword() || passwordVerified())}>
              <div style={{ 'margin-bottom': '20px' }}>
                <Show when={share()?.file?.mime_type?.startsWith('video/')}>
                  <video
                    controls
                    style={{ width: '100%', 'max-height': '400px', 'border-radius': '8px', background: '#000' }}
                    src={api.getShareStreamUrl(params.share_id, password() || undefined)}
                  />
                </Show>
                <Show when={share()?.file?.mime_type?.startsWith('audio/')}>
                  <audio
                    controls
                    style={{ width: '100%' }}
                    src={api.getShareStreamUrl(params.share_id, password() || undefined)}
                  />
                </Show>
                <Show when={share()?.file?.mime_type?.startsWith('image/')}>
                  <img
                    src={api.getShareStreamUrl(params.share_id, password() || undefined)}
                    alt={share()?.file?.file_name}
                    style={{ width: '100%', 'max-height': '400px', 'object-fit': 'contain', 'border-radius': '8px' }}
                  />
                </Show>
              </div>
            </Show>

            {/* Password Field */}
            <Show when={needsPassword() && !passwordVerified()}>
              <div style={{ 'margin-bottom': '20px' }}>
                <label style={{ display: 'block', 'margin-bottom': '5px', 'font-weight': 'bold' }}>
                  This file is password protected
                </label>
                <input
                  type="password"
                  placeholder="Enter password"
                  value={password()}
                  onInput={(e) => {
                    setPassword(e.currentTarget.value);
                    setPasswordError(null);
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') verifyPassword();
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: passwordError() ? '2px solid #dc3545' : '1px solid #ddd',
                    'border-radius': '8px',
                    'box-sizing': 'border-box',
                  }}
                />
                {passwordError() && (
                  <div style={{ 
                    color: '#dc3545', 
                    'font-size': '13px', 
                    'margin-top': '6px',
                    display: 'flex',
                    'align-items': 'center',
                    gap: '6px'
                  }}>
                    ⚠️ {passwordError()}
                  </div>
                )}
                <button
                  onClick={verifyPassword}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#007bff',
                    color: 'white',
                    border: 'none',
                    'border-radius': '6px',
                    cursor: 'pointer',
                    'font-weight': '600',
                    'margin-top': '10px',
                  }}
                >
                  🔓 Verify Password
                </button>
              </div>
            </Show>
            
            <Show when={needsPassword() && passwordVerified()}>
              <div style={{ 
                padding: '12px', 
                background: '#d4edda', 
                color: '#155724',
                'border-radius': '8px',
                'margin-bottom': '20px',
                display: 'flex',
                'align-items': 'center',
                gap: '8px'
              }}>
                ✓ Password verified. You can now download or stream the file.
              </div>
            </Show>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '10px', 'flex-wrap': 'wrap' }}>
              <button
                onClick={handleDownload}
                disabled={needsPassword() && !passwordVerified()}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  background: needsPassword() && !passwordVerified() ? '#6c757d' : '#007bff',
                  color: 'white',
                  border: 'none',
                  'border-radius': '8px',
                  'text-align': 'center',
                  'font-weight': 'bold',
                  'min-width': '120px',
                  cursor: needsPassword() && !passwordVerified() ? 'not-allowed' : 'pointer',
                  opacity: needsPassword() && !passwordVerified() ? 0.6 : 1,
                }}
              >
                ⬇️ Download
              </button>
              <Show when={isStreamable()}>
                <button
                  onClick={handleStream}
                  disabled={needsPassword() && !passwordVerified()}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    background: needsPassword() && !passwordVerified() ? '#6c757d' : '#28a745',
                    color: 'white',
                    border: 'none',
                    'border-radius': '8px',
                    'text-align': 'center',
                    'font-weight': 'bold',
                    'min-width': '120px',
                    cursor: needsPassword() && !passwordVerified() ? 'not-allowed' : 'pointer',
                    opacity: needsPassword() && !passwordVerified() ? 0.6 : 1,
                  }}
                >
                  ▶️ Stream
                </button>
              </Show>
              <Show when={api.token}>
                <button
                  onClick={forkFile}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    background: '#6f42c1',
                    color: 'white',
                    border: 'none',
                    'border-radius': '8px',
                    cursor: 'pointer',
                    'font-weight': 'bold',
                    'min-width': '120px',
                  }}
                >
                  🍴 Fork to My Storage
                </button>
              </Show>
            </div>

            {/* InfiniDrive Branding */}
            <div style={{ 'text-align': 'center', 'margin-top': '25px', 'font-size': '12px', color: '#999' }}>
              Shared via <strong>InfiniDrive</strong> — Unlimited Cloud Storage
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
