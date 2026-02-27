import { createSignal, onMount, Show, For } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import api from '../services/api';

export default function Settings() {
  const navigate = useNavigate();
  const [bots, setBots] = createSignal<any[]>([]);
  const [devices, setDevices] = createSignal<any[]>([]);
  const [folders, setFolders] = createSignal<any[]>([]);
  const [botToken, setBotToken] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);
  const [editingChannel, setEditingChannel] = createSignal<string | null>(null);
  const [channelId, setChannelId] = createSignal('');
  const [configuringBot, setConfiguringBot] = createSignal<string | null>(null);
  const [webhookLogs, setWebhookLogs] = createSignal<any[]>([]);
  const [showLogs, setShowLogs] = createSignal<string | null>(null);

  const loadData = async () => {
    try {
      const [botsRes, devicesRes, foldersRes] = await Promise.all([
        api.listBots(),
        api.listDevices(),
        api.getFolderTree().catch(() => ({ tree: [] })),
      ]);
      setBots(botsRes.bots);
      setDevices(devicesRes.devices);
      setFolders(flattenFolderTree(foldersRes.tree));
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  // Flatten folder tree into flat list with paths
  const flattenFolderTree = (tree: any[], prefix = ''): any[] => {
    const result: any[] = [];
    for (const folder of tree) {
      result.push({ folder_id: folder.folder_id, folder_name: folder.folder_name, folder_path: folder.folder_path });
      if (folder.children) {
        result.push(...flattenFolderTree(folder.children, folder.folder_path));
      }
    }
    return result;
  };

  onMount(async () => {
    if (!api.token) {
      navigate('/');
      return;
    }
    await loadData();
  });

  const showNotification = (msg: string, type: 'success' | 'error') => {
    if (type === 'success') {
      setSuccess(msg);
      setError(null);
      setTimeout(() => setSuccess(null), 4000);
    } else {
      setError(msg);
      setSuccess(null);
      setTimeout(() => setError(null), 5000);
    }
  };

  const addBot = async () => {
    if (!botToken().trim()) {
      showNotification('Bot token is required', 'error');
      return;
    }

    setLoading(true);

    try {
      const result: any = await api.addBot(botToken().trim());
      setBotToken('');
      showNotification(`Bot @${result.bot_username} added successfully!`, 'success');
      await loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Failed to add bot', 'error');
    } finally {
      setLoading(false);
    }
  };

  const removeBot = async (botId: string) => {
    if (!confirm('Are you sure you want to remove this bot?')) return;
    
    try {
      await api.removeBot(botId);
      showNotification('Bot removed successfully', 'success');
      await loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Failed to remove bot', 'error');
    }
  };

  const startEditingChannel = (botId: string, currentChannelId: string | null) => {
    setEditingChannel(botId);
    setChannelId(currentChannelId || '');
  };

  const saveChannel = async (botId: string) => {
    if (!channelId().trim()) {
      showNotification('Channel ID is required', 'error');
      return;
    }

    setLoading(true);

    try {
      await api.setBotChannel(botId, channelId().trim());
      setEditingChannel(null);
      setChannelId('');
      showNotification('Channel configured successfully!', 'success');
      await loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Failed to set channel', 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateWebhookConfig = async (botId: string, config: any) => {
    setLoading(true);
    try {
      const result: any = await api.updateWebhookConfig(botId, config);
      showNotification(result.message || 'Configuration updated!', 'success');
      await loadData();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Failed to update config', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadWebhookLogs = async (botId: string) => {
    try {
      const result = await api.getWebhookLogs(botId, { limit: 20 });
      setWebhookLogs(result.logs);
      setShowLogs(botId);
    } catch (err) {
      showNotification('Failed to load logs', 'error');
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    if (bytes > 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const formatTime = (ts: number): string => {
    return new Date(ts * 1000).toLocaleString();
  };

  return (
    <div style={{
      padding: '40px',
      'max-width': '1200px',
      margin: '0 auto',
      'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        'justify-content': 'space-between',
        'align-items': 'center',
        'margin-bottom': '30px',
      }}>
        <div>
          <h1 style={{ margin: '0', 'font-size': '28px', color: '#1a1a2e' }}>Settings</h1>
          <p style={{ margin: '5px 0 0', color: '#666', 'font-size': '14px' }}>Manage your bots, auto-upload, and devices</p>
        </div>
        <nav style={{ display: 'flex', gap: '12px' }}>
          <a href="/dashboard" style={{ color: '#007bff', 'text-decoration': 'none', 'font-weight': '500' }}>Dashboard</a>
          <a href="/files" style={{ color: '#007bff', 'text-decoration': 'none', 'font-weight': '500' }}>Files</a>
          <a href="/api" style={{ color: '#007bff', 'text-decoration': 'none', 'font-weight': '500' }}>API</a>
        </nav>
      </div>

      {/* Notifications */}
      <Show when={success()}>
        <div style={{
          padding: '12px 18px',
          background: '#d4edda',
          color: '#155724',
          'border-radius': '8px',
          'margin-bottom': '20px',
          'font-size': '14px',
          'font-weight': '500',
          border: '1px solid #c3e6cb',
        }}>
          {success()}
        </div>
      </Show>

      <Show when={error()}>
        <div style={{
          padding: '12px 18px',
          background: '#f8d7da',
          color: '#721c24',
          'border-radius': '8px',
          'margin-bottom': '20px',
          'font-size': '14px',
          'font-weight': '500',
          border: '1px solid #f5c6cb',
        }}>
          {error()}
        </div>
      </Show>

      <div style={{ display: 'grid', gap: '24px' }}>
        {/* Add New Bot */}
        <div style={{
          background: 'white',
          padding: '28px',
          'border-radius': '12px',
          'box-shadow': '0 2px 12px rgba(0,0,0,0.08)',
          border: '1px solid #e8e8e8',
        }}>
          <h2 style={{ 'margin-bottom': '20px', 'font-size': '20px', color: '#1a1a2e' }}>Add New Bot</h2>
          
          <div style={{
            'margin-bottom': '20px',
            padding: '16px',
            background: 'linear-gradient(135deg, #f8f9ff, #f0f4ff)',
            'border-radius': '8px',
            border: '1px solid #e0e7ff',
          }}>
            <p style={{ margin: '0 0 10px', 'font-size': '14px', 'font-weight': '600', color: '#4338ca' }}>
              How to get a bot token:
            </p>
            <ol style={{ margin: '0', 'padding-left': '20px', 'font-size': '13px', 'line-height': '2', color: '#555' }}>
              <li>Open Telegram and search for <code style={{ background: '#e0e7ff', padding: '2px 6px', 'border-radius': '3px', color: '#4338ca' }}>@BotFather</code></li>
              <li>Send <code style={{ background: '#e0e7ff', padding: '2px 6px', 'border-radius': '3px', color: '#4338ca' }}>/newbot</code> and follow the instructions</li>
              <li>Copy the bot token and paste it below</li>
              <li>Create a channel/group, add the bot as admin</li>
            </ol>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              placeholder="Bot token (e.g., 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)"
              value={botToken()}
              onInput={(e) => setBotToken(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && addBot()}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: '2px solid #e0e0e0',
                'border-radius': '8px',
                'font-size': '14px',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
            />
            <button
              onClick={addBot}
              disabled={loading()}
              style={{
                padding: '12px 28px',
                background: loading() ? '#94a3b8' : '#4338ca',
                color: 'white',
                border: 'none',
                'border-radius': '8px',
                cursor: loading() ? 'not-allowed' : 'pointer',
                'font-weight': '600',
                'font-size': '14px',
                'white-space': 'nowrap',
              }}
            >
              {loading() ? 'Adding...' : '+ Add Bot'}
            </button>
          </div>
        </div>

        {/* Your Bots */}
        <div style={{
          background: 'white',
          padding: '28px',
          'border-radius': '12px',
          'box-shadow': '0 2px 12px rgba(0,0,0,0.08)',
          border: '1px solid #e8e8e8',
        }}>
          <h2 style={{ 'margin-bottom': '20px', 'font-size': '20px', color: '#1a1a2e' }}>
            Your Bots ({bots().length})
          </h2>

          <Show when={bots().length === 0}>
            <div style={{
              padding: '40px',
              'text-align': 'center',
              color: '#999',
              'font-size': '15px',
            }}>
              No bots configured yet. Add your first bot above.
            </div>
          </Show>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
            <For each={bots()}>
              {(bot) => (
                <div style={{
                  padding: '20px',
                  border: '1px solid #e0e0e0',
                  'border-radius': '10px',
                  background: '#fafbfc',
                  transition: 'box-shadow 0.2s',
                }}>
                  {/* Bot Header */}
                  <div style={{
                    display: 'flex',
                    'justify-content': 'space-between',
                    'align-items': 'center',
                    'margin-bottom': '14px',
                  }}>
                    <div style={{ display: 'flex', 'align-items': 'center', gap: '12px' }}>
                      <div style={{
                        width: '42px',
                        height: '42px',
                        'border-radius': '10px',
                        background: bot.health_status === 'healthy'
                          ? 'linear-gradient(135deg, #10b981, #059669)'
                          : 'linear-gradient(135deg, #ef4444, #dc2626)',
                        display: 'flex',
                        'align-items': 'center',
                        'justify-content': 'center',
                        color: 'white',
                        'font-size': '18px',
                      }}>
                        🤖
                      </div>
                      <div>
                        <strong style={{ 'font-size': '16px', color: '#1a1a2e' }}>
                          @{bot.bot_username || 'Unknown'}
                        </strong>
                        <div style={{ 'font-size': '12px', color: '#888', 'margin-top': '2px' }}>
                          Status: <span style={{
                            color: bot.health_status === 'healthy' ? '#10b981' : '#ef4444',
                            'font-weight': '600',
                          }}>{bot.health_status}</span>
                          {bot.webhook_config?.enabled && (
                            <span style={{
                              'margin-left': '8px',
                              padding: '2px 8px',
                              background: '#dbeafe',
                              color: '#1d4ed8',
                              'border-radius': '10px',
                              'font-size': '11px',
                              'font-weight': '600',
                            }}>Auto-Upload ON</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setConfiguringBot(configuringBot() === bot.bot_id ? null : bot.bot_id)}
                        style={{
                          padding: '8px 14px',
                          background: configuringBot() === bot.bot_id ? '#4338ca' : '#f0f0f0',
                          color: configuringBot() === bot.bot_id ? 'white' : '#333',
                          border: 'none',
                          'border-radius': '6px',
                          cursor: 'pointer',
                          'font-size': '12px',
                          'font-weight': '600',
                        }}
                      >
                        {configuringBot() === bot.bot_id ? 'Close Config' : 'Configure'}
                      </button>
                      <button
                        onClick={() => removeBot(bot.bot_id)}
                        style={{
                          padding: '8px 14px',
                          background: '#fee2e2',
                          color: '#dc2626',
                          border: 'none',
                          'border-radius': '6px',
                          cursor: 'pointer',
                          'font-size': '12px',
                          'font-weight': '600',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Channel Status */}
                  <Show when={editingChannel() === bot.bot_id}>
                    <div style={{ display: 'flex', gap: '10px', 'align-items': 'center', 'margin-bottom': '14px' }}>
                      <input
                        type="text"
                        placeholder="Channel ID (e.g., -1001234567890)"
                        value={channelId()}
                        onInput={(e) => setChannelId(e.currentTarget.value)}
                        style={{
                          flex: 1,
                          padding: '10px 14px',
                          border: '2px solid #e0e0e0',
                          'border-radius': '6px',
                          'font-size': '14px',
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => saveChannel(bot.bot_id)}
                        disabled={loading()}
                        style={{
                          padding: '10px 18px',
                          background: '#10b981',
                          color: 'white',
                          border: 'none',
                          'border-radius': '6px',
                          cursor: 'pointer',
                          'font-size': '13px',
                          'font-weight': '600',
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingChannel(null); setChannelId(''); }}
                        style={{
                          padding: '10px 18px',
                          background: '#f0f0f0',
                          color: '#666',
                          border: 'none',
                          'border-radius': '6px',
                          cursor: 'pointer',
                          'font-size': '13px',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </Show>

                  <Show when={editingChannel() !== bot.bot_id}>
                    <div style={{
                      display: 'flex',
                      'justify-content': 'space-between',
                      'align-items': 'center',
                      padding: '10px 14px',
                      background: bot.channel_id ? '#ecfdf5' : '#fef2f2',
                      'border-radius': '6px',
                      'margin-bottom': '6px',
                    }}>
                      <span style={{ 'font-size': '13px', color: bot.channel_id ? '#065f46' : '#991b1b' }}>
                        {bot.channel_id
                          ? `✓ Storage channel: ${bot.channel_id}`
                          : '⚠ No storage channel configured'}
                      </span>
                      <button
                        onClick={() => startEditingChannel(bot.bot_id, bot.channel_id)}
                        style={{
                          padding: '5px 12px',
                          background: bot.channel_id ? '#f0f0f0' : '#4338ca',
                          color: bot.channel_id ? '#333' : 'white',
                          border: 'none',
                          'border-radius': '4px',
                          cursor: 'pointer',
                          'font-size': '12px',
                          'font-weight': '500',
                        }}
                      >
                        {bot.channel_id ? 'Change' : 'Configure Channel'}
                      </button>
                    </div>
                  </Show>

                  {/* Auto-Upload Configuration Panel */}
                  <Show when={configuringBot() === bot.bot_id}>
                    <div style={{
                      'margin-top': '16px',
                      padding: '20px',
                      background: 'white',
                      'border-radius': '10px',
                      border: '2px solid #e0e7ff',
                    }}>
                      <h3 style={{ margin: '0 0 18px', 'font-size': '16px', color: '#4338ca' }}>
                        Auto-Upload Configuration
                      </h3>

                      <div style={{
                        padding: '14px',
                        background: '#f0f4ff',
                        'border-radius': '8px',
                        'margin-bottom': '18px',
                        'font-size': '13px',
                        color: '#555',
                        'line-height': '1.6',
                      }}>
                        <strong>How it works:</strong> When enabled, any file sent to this bot (via DM) or posted in its channel
                        will be automatically captured to your InfiniDrive storage. No re-uploading needed &mdash; files
                        are already stored on Telegram!
                      </div>

                      {/* Enable/Disable Toggle */}
                      <div style={{
                        display: 'flex',
                        'justify-content': 'space-between',
                        'align-items': 'center',
                        padding: '14px',
                        background: '#f8f9fa',
                        'border-radius': '8px',
                        'margin-bottom': '14px',
                      }}>
                        <div>
                          <strong style={{ 'font-size': '14px' }}>Enable Auto-Upload</strong>
                          <div style={{ 'font-size': '12px', color: '#888', 'margin-top': '2px' }}>
                            Capture files sent to this bot automatically
                          </div>
                        </div>
                        <button
                          onClick={() => updateWebhookConfig(bot.bot_id, {
                            ...bot.webhook_config,
                            is_enabled: !bot.webhook_config?.enabled,
                          })}
                          disabled={loading()}
                          style={{
                            padding: '8px 20px',
                            background: bot.webhook_config?.enabled ? '#10b981' : '#e5e7eb',
                            color: bot.webhook_config?.enabled ? 'white' : '#666',
                            border: 'none',
                            'border-radius': '20px',
                            cursor: 'pointer',
                            'font-weight': '600',
                            'font-size': '13px',
                            transition: 'all 0.2s',
                          }}
                        >
                          {bot.webhook_config?.enabled ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      {/* Target Folder */}
                      <div style={{
                        padding: '14px',
                        background: '#f8f9fa',
                        'border-radius': '8px',
                        'margin-bottom': '14px',
                      }}>
                        <label style={{ display: 'block', 'font-weight': '600', 'font-size': '14px', 'margin-bottom': '8px' }}>
                          Target Folder
                        </label>
                        <select
                          value={bot.webhook_config?.target_folder_id || ''}
                          onChange={(e) => updateWebhookConfig(bot.bot_id, {
                            ...bot.webhook_config,
                            is_enabled: bot.webhook_config?.enabled,
                            target_folder_id: e.currentTarget.value || null,
                          })}
                          style={{
                            width: '100%',
                            padding: '10px 14px',
                            border: '2px solid #e0e0e0',
                            'border-radius': '6px',
                            'font-size': '14px',
                            background: 'white',
                            outline: 'none',
                          }}
                        >
                          <option value="">/ (Root)</option>
                          <For each={folders()}>
                            {(folder) => (
                              <option value={folder.folder_id}>
                                {folder.folder_path}
                              </option>
                            )}
                          </For>
                        </select>
                        <div style={{ 'font-size': '12px', color: '#888', 'margin-top': '4px' }}>
                          Files captured from this bot will be saved here
                        </div>
                      </div>

                      {/* Auto-Categorize */}
                      <div style={{
                        display: 'flex',
                        'justify-content': 'space-between',
                        'align-items': 'center',
                        padding: '14px',
                        background: '#f8f9fa',
                        'border-radius': '8px',
                        'margin-bottom': '14px',
                      }}>
                        <div>
                          <strong style={{ 'font-size': '14px' }}>Auto-Categorize</strong>
                          <div style={{ 'font-size': '12px', color: '#888', 'margin-top': '2px' }}>
                            Automatically sort files into sub-folders (Images, Videos, Documents, etc.)
                          </div>
                        </div>
                        <button
                          onClick={() => updateWebhookConfig(bot.bot_id, {
                            ...bot.webhook_config,
                            is_enabled: bot.webhook_config?.enabled,
                            auto_categorize: !bot.webhook_config?.auto_categorize,
                          })}
                          disabled={loading()}
                          style={{
                            padding: '8px 20px',
                            background: bot.webhook_config?.auto_categorize ? '#10b981' : '#e5e7eb',
                            color: bot.webhook_config?.auto_categorize ? 'white' : '#666',
                            border: 'none',
                            'border-radius': '20px',
                            cursor: 'pointer',
                            'font-weight': '600',
                            'font-size': '13px',
                          }}
                        >
                          {bot.webhook_config?.auto_categorize ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      {/* Capture Sources */}
                      <div style={{
                        padding: '14px',
                        background: '#f8f9fa',
                        'border-radius': '8px',
                        'margin-bottom': '14px',
                      }}>
                        <strong style={{ display: 'block', 'font-size': '14px', 'margin-bottom': '10px' }}>
                          Capture Sources
                        </strong>
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <label style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '8px',
                            'font-size': '13px',
                            cursor: 'pointer',
                            padding: '8px 14px',
                            background: bot.webhook_config?.capture_from_bot !== false ? '#dbeafe' : '#f0f0f0',
                            'border-radius': '6px',
                            border: `2px solid ${bot.webhook_config?.capture_from_bot !== false ? '#93c5fd' : '#e0e0e0'}`,
                          }}>
                            <input
                              type="checkbox"
                              checked={bot.webhook_config?.capture_from_bot !== false}
                              onChange={(e) => updateWebhookConfig(bot.bot_id, {
                                ...bot.webhook_config,
                                is_enabled: bot.webhook_config?.enabled,
                                capture_from_bot: e.currentTarget.checked,
                              })}
                            />
                            Bot DM (Direct Messages)
                          </label>
                          <label style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '8px',
                            'font-size': '13px',
                            cursor: 'pointer',
                            padding: '8px 14px',
                            background: bot.webhook_config?.capture_from_channel !== false ? '#dbeafe' : '#f0f0f0',
                            'border-radius': '6px',
                            border: `2px solid ${bot.webhook_config?.capture_from_channel !== false ? '#93c5fd' : '#e0e0e0'}`,
                          }}>
                            <input
                              type="checkbox"
                              checked={bot.webhook_config?.capture_from_channel !== false}
                              onChange={(e) => updateWebhookConfig(bot.bot_id, {
                                ...bot.webhook_config,
                                is_enabled: bot.webhook_config?.enabled,
                                capture_from_channel: e.currentTarget.checked,
                              })}
                            />
                            Channel / Group Posts
                          </label>
                        </div>
                      </div>

                      {/* File Type Filter */}
                      <div style={{
                        padding: '14px',
                        background: '#f8f9fa',
                        'border-radius': '8px',
                        'margin-bottom': '14px',
                      }}>
                        <strong style={{ display: 'block', 'font-size': '14px', 'margin-bottom': '10px' }}>
                          Allowed File Types
                        </strong>
                        <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '8px' }}>
                          {['all', 'documents', 'photos', 'videos', 'audio'].map((type) => {
                            const currentTypes = bot.webhook_config?.allowed_types || 'all';
                            const isAll = currentTypes === 'all';
                            const isSelected = type === 'all' ? isAll : !isAll && currentTypes.includes(type);

                            return (
                              <button
                                onClick={() => {
                                  if (type === 'all') {
                                    updateWebhookConfig(bot.bot_id, {
                                      ...bot.webhook_config,
                                      is_enabled: bot.webhook_config?.enabled,
                                      allowed_types: 'all',
                                    });
                                  } else {
                                    let types = isAll ? [] : currentTypes.split(',').map((t: string) => t.trim());
                                    if (types.includes(type)) {
                                      types = types.filter((t: string) => t !== type);
                                    } else {
                                      types.push(type);
                                    }
                                    updateWebhookConfig(bot.bot_id, {
                                      ...bot.webhook_config,
                                      is_enabled: bot.webhook_config?.enabled,
                                      allowed_types: types.length === 0 ? 'all' : types.join(','),
                                    });
                                  }
                                }}
                                style={{
                                  padding: '6px 14px',
                                  background: isSelected ? '#4338ca' : '#f0f0f0',
                                  color: isSelected ? 'white' : '#555',
                                  border: 'none',
                                  'border-radius': '16px',
                                  cursor: 'pointer',
                                  'font-size': '12px',
                                  'font-weight': '600',
                                  'text-transform': 'capitalize',
                                }}
                              >
                                {type === 'all' ? 'All Types' : type}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Webhook Logs */}
                      <div style={{
                        display: 'flex',
                        gap: '10px',
                        'margin-top': '14px',
                      }}>
                        <button
                          onClick={() => showLogs() === bot.bot_id ? setShowLogs(null) : loadWebhookLogs(bot.bot_id)}
                          style={{
                            padding: '10px 18px',
                            background: '#f0f0f0',
                            color: '#333',
                            border: 'none',
                            'border-radius': '6px',
                            cursor: 'pointer',
                            'font-size': '13px',
                            'font-weight': '600',
                          }}
                        >
                          {showLogs() === bot.bot_id ? 'Hide Logs' : 'View Capture Logs'}
                        </button>
                      </div>

                      {/* Logs Panel */}
                      <Show when={showLogs() === bot.bot_id}>
                        <div style={{
                          'margin-top': '14px',
                          'max-height': '300px',
                          'overflow-y': 'auto',
                          border: '1px solid #e0e0e0',
                          'border-radius': '8px',
                        }}>
                          <Show when={webhookLogs().length === 0}>
                            <div style={{ padding: '20px', 'text-align': 'center', color: '#999', 'font-size': '13px' }}>
                              No capture logs yet. Send a file to the bot to see it here!
                            </div>
                          </Show>
                          <For each={webhookLogs()}>
                            {(log) => (
                              <div style={{
                                padding: '12px 16px',
                                'border-bottom': '1px solid #f0f0f0',
                                'font-size': '13px',
                                display: 'flex',
                                'justify-content': 'space-between',
                                'align-items': 'center',
                              }}>
                                <div>
                                  <div style={{ 'font-weight': '600', color: '#1a1a2e' }}>
                                    {log.file_name || 'Unknown file'}
                                  </div>
                                  <div style={{ color: '#888', 'font-size': '11px', 'margin-top': '2px' }}>
                                    {log.sender_username ? `@${log.sender_username}` : log.sender_name || 'Unknown'} 
                                    {' • '}
                                    {formatSize(log.file_size || 0)}
                                    {' • '}
                                    {formatTime(log.created_at)}
                                  </div>
                                </div>
                                <span style={{
                                  padding: '3px 10px',
                                  'border-radius': '10px',
                                  'font-size': '11px',
                                  'font-weight': '600',
                                  background: log.status === 'captured' ? '#d1fae5'
                                    : log.status === 'skipped' ? '#fef3c7'
                                    : log.status === 'failed' ? '#fee2e2' : '#f0f0f0',
                                  color: log.status === 'captured' ? '#065f46'
                                    : log.status === 'skipped' ? '#92400e'
                                    : log.status === 'failed' ? '#991b1b' : '#666',
                                }}>
                                  {log.status}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Devices */}
        <div style={{
          background: 'white',
          padding: '28px',
          'border-radius': '12px',
          'box-shadow': '0 2px 12px rgba(0,0,0,0.08)',
          border: '1px solid #e8e8e8',
        }}>
          <h2 style={{ 'margin-bottom': '20px', 'font-size': '20px', color: '#1a1a2e' }}>Devices</h2>
          <Show when={devices().length === 0}>
            <p style={{ color: '#999', 'font-size': '14px' }}>No devices registered yet.</p>
          </Show>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <For each={devices()}>
              {(device) => (
                <div style={{
                  padding: '16px',
                  border: '1px solid #e0e0e0',
                  'border-radius': '8px',
                  background: '#fafbfc',
                }}>
                  <strong>{device.device_name}</strong>
                  <div style={{ 'font-size': '12px', color: '#888', 'margin-top': '4px' }}>
                    {device.device_type} • Last seen: {formatTime(device.last_seen)}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
