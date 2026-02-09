import { createSignal, onMount, Show, For } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import api from '../services/api';

export default function ApiKeys() {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<'projects' | 'keys' | 'docs'>('projects');
  const [projects, setProjects] = createSignal<any[]>([]);
  const [keys, setKeys] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal(true);

  // Create project dialog
  const [showCreateProject, setShowCreateProject] = createSignal(false);
  const [newProjectName, setNewProjectName] = createSignal('');
  const [newProjectDesc, setNewProjectDesc] = createSignal('');

  // Create key dialog
  const [showCreateKey, setShowCreateKey] = createSignal(false);
  const [newKeyName, setNewKeyName] = createSignal('');
  const [newKeyProjectId, setNewKeyProjectId] = createSignal('');
  const [newKeyPermissions, setNewKeyPermissions] = createSignal('read,write');
  const [newKeyExpiry, setNewKeyExpiry] = createSignal('');
  const [createdKey, setCreatedKey] = createSignal<string | null>(null);

  const [toasts, setToasts] = createSignal<{ id: number; msg: string; type: string }[]>([]);
  let toastId = 0;
  const addToast = (msg: string, type = 'info') => {
    const id = ++toastId;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (ts: number) => ts ? new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';

  const loadData = async () => {
    try {
      const [projRes, keysRes] = await Promise.all([
        api.listProjects(),
        api.listApiKeys(),
      ]);
      setProjects((projRes as any).projects || []);
      setKeys((keysRes as any).keys || []);
    } catch (err) {
      console.error('Failed to load:', err);
      addToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  onMount(async () => {
    if (!api.token) { navigate('/'); return; }
    await loadData();
  });

  const handleCreateProject = async () => {
    if (!newProjectName().trim()) return;
    try {
      await api.createProject(newProjectName().trim(), newProjectDesc().trim());
      setShowCreateProject(false);
      setNewProjectName('');
      setNewProjectDesc('');
      addToast('Project created!', 'success');
      await loadData();
    } catch (err: any) {
      addToast(err.message || 'Failed to create project', 'error');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Delete this project? All API keys for this project will be revoked.')) return;
    try {
      await api.deleteProject(projectId);
      addToast('Project deleted', 'success');
      await loadData();
    } catch (err: any) {
      addToast(err.message || 'Failed to delete', 'error');
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName().trim() || !newKeyProjectId()) return;
    try {
      const res: any = await api.createApiKey({
        project_id: newKeyProjectId(),
        key_name: newKeyName().trim(),
        permissions: newKeyPermissions(),
        expires_in_days: newKeyExpiry() ? parseInt(newKeyExpiry()) : undefined,
      });
      setCreatedKey(res.api_key);
      addToast('API key created! Copy it now — it won\'t be shown again.', 'warning');
      await loadData();
    } catch (err: any) {
      addToast(err.message || 'Failed to create key', 'error');
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm('Revoke this API key? Any apps using it will stop working.')) return;
    try {
      await api.revokeApiKey(keyId);
      addToast('API key revoked', 'success');
      await loadData();
    } catch (err: any) {
      addToast(err.message || 'Failed to revoke', 'error');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => addToast('Copied to clipboard!', 'success'));
  };

  const apiBaseUrl = api.baseUrl;

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100vh' }}>
      {/* Toasts */}
      <div class="fm-toast-container">
        <For each={toasts()}>{(t) => <div class={`fm-toast ${t.type}`}>{t.msg}</div>}</For>
      </div>

      {/* Header */}
      <header style={{
        height: '56px', background: 'var(--surface)', 'border-bottom': '1px solid var(--border)',
        display: 'flex', 'align-items': 'center', padding: '0 20px', gap: '20px', 'flex-shrink': 0,
      }}>
        <a href="/files" style={{ 'text-decoration': 'none', display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <span style={{ 'font-size': '22px' }}>♾️</span>
          <span style={{ 'font-weight': '700', 'font-size': '18px', color: 'var(--text)' }}>InfiniDrive</span>
        </a>
        <span style={{ color: 'var(--text-muted)' }}>›</span>
        <span style={{ 'font-weight': '600' }}>API & Projects</span>
        <div style={{ 'margin-left': 'auto', display: 'flex', gap: '8px' }}>
          <a href="/files" class="fm-btn">📁 Files</a>
          <a href="/settings" class="fm-btn">⚙️ Settings</a>
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', 'max-width': '1200px', margin: '0 auto', width: '100%' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', 'margin-bottom': '24px', 'border-bottom': '2px solid var(--border)', 'padding-bottom': '0' }}>
          {(['projects', 'keys', 'docs'] as const).map(t => (
            <button
              class="fm-btn-ghost"
              style={{
                padding: '10px 20px', 'font-size': '14px', 'font-weight': '600',
                color: tab() === t ? 'var(--primary)' : 'var(--text-muted)',
                'border-bottom': tab() === t ? '2px solid var(--primary)' : '2px solid transparent',
                'border-radius': 0, 'margin-bottom': '-2px', cursor: 'pointer',
                background: 'none', border: 'none',
              }}
              onClick={() => setTab(t)}
            >
              {t === 'projects' ? '📦 Projects' : t === 'keys' ? '🔑 API Keys' : '📖 Documentation'}
            </button>
          ))}
        </div>

        {/* ===== PROJECTS TAB ===== */}
        <Show when={tab() === 'projects'}>
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '20px' }}>
            <div>
              <h2 style={{ margin: 0 }}>Projects</h2>
              <p style={{ color: 'var(--text-muted)', 'font-size': '14px', margin: '4px 0 0' }}>
                Each project gets its own folder. API keys are scoped to a project.
              </p>
            </div>
            <button class="fm-btn fm-btn-primary" onClick={() => setShowCreateProject(true)}>+ New Project</button>
          </div>

          <Show when={loading()}>
            <div style={{ padding: '40px', 'text-align': 'center', color: 'var(--text-muted)' }}>Loading...</div>
          </Show>

          <Show when={!loading() && projects().length === 0}>
            <div class="fm-empty">
              <div class="fm-empty-icon">📦</div>
              <div class="fm-empty-title">No projects yet</div>
              <div class="fm-empty-desc">Create your first project to start using the API.</div>
              <button class="fm-btn fm-btn-primary" style={{ 'margin-top': '16px' }} onClick={() => setShowCreateProject(true)}>+ Create Project</button>
            </div>
          </Show>

          <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
            <For each={projects()}>
              {(proj) => (
                <div style={{
                  background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)',
                  padding: '20px', position: 'relative',
                }}>
                  <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-start' }}>
                    <div>
                      <div style={{ 'font-size': '18px', 'font-weight': '700', 'margin-bottom': '4px' }}>📦 {proj.project_name}</div>
                      <div style={{ 'font-size': '13px', color: 'var(--text-muted)', 'margin-bottom': '12px' }}>{proj.description || 'No description'}</div>
                    </div>
                    <button class="fm-btn fm-btn-sm fm-btn-danger" onClick={() => handleDeleteProject(proj.project_id)}>Delete</button>
                  </div>
                  <div style={{ display: 'flex', gap: '20px', 'font-size': '13px', color: 'var(--text-secondary)' }}>
                    <span>🔑 {proj.key_count || 0} key(s)</span>
                    <span>📄 {proj.file_count || 0} file(s)</span>
                    <span>💾 {formatBytes(proj.total_size || 0)}</span>
                  </div>
                  <div style={{ 'font-size': '11px', color: 'var(--text-muted)', 'margin-top': '10px' }}>
                    Created {formatDate(proj.created_at)} · ID: <code style={{ 'font-size': '10px', background: 'var(--bg)', padding: '2px 4px', 'border-radius': '3px' }}>{proj.project_id}</code>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* ===== API KEYS TAB ===== */}
        <Show when={tab() === 'keys'}>
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '20px' }}>
            <div>
              <h2 style={{ margin: 0 }}>API Keys</h2>
              <p style={{ color: 'var(--text-muted)', 'font-size': '14px', margin: '4px 0 0' }}>
                Manage API keys for programmatic access. Keys are scoped to a project.
              </p>
            </div>
            <button
              class="fm-btn fm-btn-primary"
              onClick={() => { setShowCreateKey(true); setCreatedKey(null); setNewKeyName(''); setNewKeyProjectId(projects()[0]?.project_id || ''); }}
              disabled={projects().length === 0}
            >
              + New API Key
            </button>
          </div>

          <Show when={projects().length === 0}>
            <div style={{ padding: '20px', background: 'var(--warning-light)', 'border-radius': 'var(--radius)', 'margin-bottom': '20px', 'font-size': '14px' }}>
              ⚠️ Create a project first before generating API keys.
            </div>
          </Show>

          <Show when={keys().length === 0 && !loading()}>
            <div class="fm-empty">
              <div class="fm-empty-icon">🔑</div>
              <div class="fm-empty-title">No API keys</div>
              <div class="fm-empty-desc">Create an API key to start using the InfiniDrive API programmatically.</div>
            </div>
          </Show>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <For each={keys()}>
              {(key) => (
                <div style={{
                  background: 'var(--surface)', 'border-radius': 'var(--radius)', border: '1px solid var(--border)',
                  padding: '16px 20px', display: 'flex', 'align-items': 'center', gap: '16px',
                }}>
                  <div style={{ 'font-size': '28px' }}>🔑</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ 'font-weight': '600', 'margin-bottom': '2px' }}>{key.key_name}</div>
                    <div style={{ 'font-size': '12px', display: 'flex', gap: '12px', color: 'var(--text-muted)' }}>
                      <code style={{ background: 'var(--bg)', padding: '1px 6px', 'border-radius': '3px' }}>{key.key_prefix}</code>
                      <span>📦 {key.project_name}</span>
                      <span>🛡️ {key.permissions}</span>
                      <span>Last used: {key.last_used_at ? formatDate(key.last_used_at) : 'Never'}</span>
                      {key.expires_at && <span>Expires: {formatDate(key.expires_at)}</span>}
                    </div>
                  </div>
                  <button class="fm-btn fm-btn-sm fm-btn-danger" onClick={() => handleRevokeKey(key.key_id)}>Revoke</button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* ===== DOCUMENTATION TAB ===== */}
        <Show when={tab() === 'docs'}>
          <h2 style={{ 'margin-bottom': '8px' }}>📖 API Documentation</h2>
          <p style={{ color: 'var(--text-muted)', 'margin-bottom': '24px' }}>
            Use the InfiniDrive API to upload, manage, and download files programmatically.
          </p>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '20px' }}>
            {/* Auth */}
            <div style={{ background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
              <h3 style={{ 'margin-bottom': '12px' }}>🔐 Authentication</h3>
              <p style={{ 'font-size': '14px', 'margin-bottom': '12px' }}>
                All API requests require an API key. Pass it via the <code>Authorization</code> header:
              </p>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', overflow: 'auto', 'font-size': '13px' }}>
{`Authorization: Bearer infini_your_api_key_here`}
              </pre>
            </div>

            {/* Base URL */}
            <div style={{ background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
              <h3 style={{ 'margin-bottom': '12px' }}>🌐 Base URL</h3>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', 'font-size': '13px' }}>
{apiBaseUrl}/api/v1/
              </pre>
            </div>

            {/* Upload */}
            <div style={{ background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
              <h3 style={{ 'margin-bottom': '12px' }}>⬆️ Upload File</h3>
              <p style={{ 'font-size': '14px', color: 'var(--text-secondary)', 'margin-bottom': '12px' }}>
                <code>POST /api/v1/files/upload</code> — Single-request upload. File data as base64.
              </p>

              <h4 style={{ 'margin': '16px 0 8px', 'font-size': '13px', color: 'var(--text-muted)' }}>cURL:</h4>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', overflow: 'auto', 'font-size': '12px', 'white-space': 'pre-wrap' }}>
{`curl -X POST ${apiBaseUrl}/api/v1/files/upload \\
  -H "Authorization: Bearer infini_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "file_name": "report.pdf",
    "file_data": "'$(base64 -w0 report.pdf)'",
    "mime_type": "application/pdf"
  }'`}
              </pre>

              <h4 style={{ 'margin': '16px 0 8px', 'font-size': '13px', color: 'var(--text-muted)' }}>Python:</h4>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', overflow: 'auto', 'font-size': '12px', 'white-space': 'pre-wrap' }}>
{`import requests, base64

API_KEY = "infini_your_key"
BASE = "${apiBaseUrl}/api/v1"

# Upload a file
with open("report.pdf", "rb") as f:
    data = base64.b64encode(f.read()).decode()

resp = requests.post(f"{BASE}/files/upload",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "file_name": "report.pdf",
        "file_data": data,
        "mime_type": "application/pdf"
    })
print(resp.json())  # {"file_id": "file_...", "status": "completed"}`}
              </pre>

              <h4 style={{ 'margin': '16px 0 8px', 'font-size': '13px', color: 'var(--text-muted)' }}>JavaScript / Node.js:</h4>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', overflow: 'auto', 'font-size': '12px', 'white-space': 'pre-wrap' }}>
{`const fs = require('fs');

const API_KEY = 'infini_your_key';
const BASE = '${apiBaseUrl}/api/v1';

// Upload a file
const fileData = fs.readFileSync('report.pdf').toString('base64');
const resp = await fetch(BASE + '/files/upload', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    file_name: 'report.pdf',
    file_data: fileData,
    mime_type: 'application/pdf',
  }),
});
console.log(await resp.json());`}
              </pre>
            </div>

            {/* List Files */}
            <div style={{ background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
              <h3 style={{ 'margin-bottom': '12px' }}>📋 List Files</h3>
              <p style={{ 'font-size': '14px', color: 'var(--text-secondary)', 'margin-bottom': '12px' }}>
                <code>GET /api/v1/files</code> — Lists files in the project folder. Optional: <code>?folder_id=</code>, <code>?limit=</code>, <code>?offset=</code>
              </p>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', overflow: 'auto', 'font-size': '12px', 'white-space': 'pre-wrap' }}>
{`curl ${apiBaseUrl}/api/v1/files \\
  -H "Authorization: Bearer infini_your_key"`}
              </pre>
            </div>

            {/* Download */}
            <div style={{ background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
              <h3 style={{ 'margin-bottom': '12px' }}>⬇️ Download File</h3>
              <p style={{ 'font-size': '14px', color: 'var(--text-secondary)', 'margin-bottom': '12px' }}>
                <code>GET /api/v1/files/:file_id/download</code>
              </p>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', overflow: 'auto', 'font-size': '12px', 'white-space': 'pre-wrap' }}>
{`curl -o output.pdf ${apiBaseUrl}/api/v1/files/FILE_ID/download \\
  -H "Authorization: Bearer infini_your_key"`}
              </pre>
            </div>

            {/* Create Folder */}
            <div style={{ background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
              <h3 style={{ 'margin-bottom': '12px' }}>📁 Create Folder</h3>
              <p style={{ 'font-size': '14px', color: 'var(--text-secondary)', 'margin-bottom': '12px' }}>
                <code>POST /api/v1/folders</code> — Create a subfolder. Pass <code>folder_name</code> and optional <code>parent_folder_id</code>.
              </p>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', overflow: 'auto', 'font-size': '12px', 'white-space': 'pre-wrap' }}>
{`curl -X POST ${apiBaseUrl}/api/v1/folders \\
  -H "Authorization: Bearer infini_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"folder_name": "backups"}'`}
              </pre>
            </div>

            {/* Delete */}
            <div style={{ background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
              <h3 style={{ 'margin-bottom': '12px' }}>🗑️ Delete File</h3>
              <p style={{ 'font-size': '14px', color: 'var(--text-secondary)', 'margin-bottom': '12px' }}>
                <code>DELETE /api/v1/files/:file_id</code>
              </p>
              <pre style={{ background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '16px', 'border-radius': 'var(--radius)', overflow: 'auto', 'font-size': '12px', 'white-space': 'pre-wrap' }}>
{`curl -X DELETE ${apiBaseUrl}/api/v1/files/FILE_ID \\
  -H "Authorization: Bearer infini_your_key"`}
              </pre>
            </div>

            {/* All Endpoints Summary */}
            <div style={{ background: 'var(--surface)', 'border-radius': 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
              <h3 style={{ 'margin-bottom': '16px' }}>📚 All Endpoints</h3>
              <table style={{ width: '100%', 'border-collapse': 'collapse', 'font-size': '13px' }}>
                <thead>
                  <tr style={{ 'border-bottom': '2px solid var(--border)' }}>
                    <th style={{ 'text-align': 'left', padding: '8px 12px' }}>Method</th>
                    <th style={{ 'text-align': 'left', padding: '8px 12px' }}>Endpoint</th>
                    <th style={{ 'text-align': 'left', padding: '8px 12px' }}>Description</th>
                    <th style={{ 'text-align': 'left', padding: '8px 12px' }}>Permission</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['POST', '/files/upload', 'Upload file (single request, base64)', 'write'],
                    ['POST', '/files/upload/init', 'Initialize chunked upload', 'write'],
                    ['POST', '/files/upload/chunk', 'Upload a chunk', 'write'],
                    ['POST', '/files/upload/complete', 'Complete chunked upload', 'write'],
                    ['GET', '/files', 'List files in project', 'read'],
                    ['GET', '/files/:id', 'Get file details', 'read'],
                    ['GET', '/files/:id/download', 'Download file', 'read'],
                    ['DELETE', '/files/:id', 'Delete file', 'write'],
                    ['POST', '/folders', 'Create folder', 'write'],
                    ['GET', '/folders', 'List folders', 'read'],
                    ['DELETE', '/folders/:id', 'Delete folder', 'write'],
                    ['GET', '/project', 'Get project info', 'read'],
                  ].map(([method, endpoint, desc, perm]) => (
                    <tr style={{ 'border-bottom': '1px solid var(--border-light)' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <span class={`fm-badge ${method === 'GET' ? 'fm-badge-success' : method === 'POST' ? 'fm-badge-info' : 'fm-badge-warning'}`}>
                          {method}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px' }}><code style={{ 'font-size': '12px' }}>/api/v1{endpoint}</code></td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{desc}</td>
                      <td style={{ padding: '8px 12px' }}><span class="fm-badge fm-badge-info">{perm}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Show>
      </div>

      {/* ===== CREATE PROJECT MODAL ===== */}
      <Show when={showCreateProject()}>
        <div class="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCreateProject(false); }}>
          <div class="fm-modal">
            <div class="fm-modal-header">📦 New Project</div>
            <div class="fm-modal-body">
              <div style={{ 'margin-bottom': '14px' }}>
                <label style={{ display: 'block', 'margin-bottom': '4px', 'font-size': '13px', 'font-weight': '500' }}>Project Name *</label>
                <input class="fm-input" type="text" placeholder="e.g. My App Backups" value={newProjectName()} onInput={(e) => setNewProjectName(e.currentTarget.value)} autofocus />
              </div>
              <div>
                <label style={{ display: 'block', 'margin-bottom': '4px', 'font-size': '13px', 'font-weight': '500' }}>Description</label>
                <input class="fm-input" type="text" placeholder="Optional description" value={newProjectDesc()} onInput={(e) => setNewProjectDesc(e.currentTarget.value)} />
              </div>
            </div>
            <div class="fm-modal-footer">
              <button class="fm-btn" onClick={() => setShowCreateProject(false)}>Cancel</button>
              <button class="fm-btn fm-btn-primary" onClick={handleCreateProject}>Create Project</button>
            </div>
          </div>
        </div>
      </Show>

      {/* ===== CREATE API KEY MODAL ===== */}
      <Show when={showCreateKey()}>
        <div class="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowCreateKey(false); setCreatedKey(null); } }}>
          <div class="fm-modal">
            <div class="fm-modal-header">🔑 {createdKey() ? 'API Key Created' : 'New API Key'}</div>
            <div class="fm-modal-body">
              <Show when={!createdKey()} fallback={
                <div>
                  <div style={{
                    background: 'var(--warning-light)', 'border-radius': 'var(--radius)', padding: '12px',
                    'margin-bottom': '16px', 'font-size': '13px',
                  }}>
                    ⚠️ <strong>Copy this key now!</strong> It will not be displayed again.
                  </div>
                  <div style={{
                    background: 'var(--sidebar-bg)', color: '#e2e8f0', padding: '14px', 'border-radius': 'var(--radius)',
                    'font-family': 'monospace', 'font-size': '13px', 'word-break': 'break-all', 'margin-bottom': '12px',
                  }}>
                    {createdKey()}
                  </div>
                  <button class="fm-btn fm-btn-primary" style={{ width: '100%' }} onClick={() => copyToClipboard(createdKey()!)}>
                    📋 Copy to Clipboard
                  </button>
                </div>
              }>
                <div style={{ 'margin-bottom': '14px' }}>
                  <label style={{ display: 'block', 'margin-bottom': '4px', 'font-size': '13px', 'font-weight': '500' }}>Key Name *</label>
                  <input class="fm-input" type="text" placeholder="e.g. Production Backend" value={newKeyName()} onInput={(e) => setNewKeyName(e.currentTarget.value)} autofocus />
                </div>
                <div style={{ 'margin-bottom': '14px' }}>
                  <label style={{ display: 'block', 'margin-bottom': '4px', 'font-size': '13px', 'font-weight': '500' }}>Project *</label>
                  <select class="fm-select" style={{ width: '100%' }} value={newKeyProjectId()} onChange={(e) => setNewKeyProjectId(e.currentTarget.value)}>
                    <For each={projects()}>{(p) => <option value={p.project_id}>{p.project_name}</option>}</For>
                  </select>
                </div>
                <div style={{ 'margin-bottom': '14px' }}>
                  <label style={{ display: 'block', 'margin-bottom': '4px', 'font-size': '13px', 'font-weight': '500' }}>Permissions</label>
                  <select class="fm-select" style={{ width: '100%' }} value={newKeyPermissions()} onChange={(e) => setNewKeyPermissions(e.currentTarget.value)}>
                    <option value="read,write">Read & Write</option>
                    <option value="read">Read Only</option>
                    <option value="write">Write Only</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', 'margin-bottom': '4px', 'font-size': '13px', 'font-weight': '500' }}>Expiry (days, optional)</label>
                  <input class="fm-input" type="number" placeholder="e.g. 90 (leave empty for no expiry)" value={newKeyExpiry()} onInput={(e) => setNewKeyExpiry(e.currentTarget.value)} />
                </div>
              </Show>
            </div>
            <div class="fm-modal-footer">
              <button class="fm-btn" onClick={() => { setShowCreateKey(false); setCreatedKey(null); }}>
                {createdKey() ? 'Done' : 'Cancel'}
              </button>
              <Show when={!createdKey()}>
                <button class="fm-btn fm-btn-primary" onClick={handleCreateKey}>Generate Key</button>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
