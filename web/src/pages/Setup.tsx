import { createSignal, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import api from '../services/api';

export default function Setup() {
  const navigate = useNavigate();
  const [botToken, setBotToken] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [bots, setBots] = createSignal<any[]>([]);
  const [editingChannel, setEditingChannel] = createSignal<string | null>(null);
  const [channelId, setChannelId] = createSignal('');
  const [pollingBots, setPollingBots] = createSignal<Set<string>>(new Set());

  onMount(async () => {
    if (!api.token) {
      navigate('/');
      return;
    }
    await loadBots();
  });

  const loadBots = async () => {
    try {
      const response = await api.listBots();
      setBots(response.bots);
    } catch (err) {
      console.error('Failed to load bots:', err);
    }
  };

  const addBot = async () => {
    if (!botToken().trim()) {
      setError('Bot token is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.addBot(botToken().trim());
      setBotToken('');
      
      // Show setup instructions
      alert(`✅ Bot @${result.bot_username} added!\n\nNext: Create a channel, add this bot as admin, and it will configure automatically!`);
      
      await loadBots();
      
      // Start polling for channel configuration (webhook will update it)
      if (!result.channel_id) {
        startPollingForChannel(result.bot_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add bot');
    } finally {
      setLoading(false);
    }
  };

  const removeBot = async (botId: string) => {
    try {
      await api.removeBot(botId);
      await loadBots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove bot');
    }
  };

  const startEditingChannel = (botId: string, currentChannelId: string | null) => {
    setEditingChannel(botId);
    setChannelId(currentChannelId || '');
  };

  const startPollingForChannel = (botId: string) => {
    // Poll every 3 seconds to check if channel was auto-configured
    const interval = setInterval(async () => {
      try {
        const response = await api.listBots();
        const bot = response.bots.find(b => b.bot_id === botId);
        
        if (bot?.channel_id) {
          // Channel configured! Stop polling
          clearInterval(interval);
          setPollingBots(prev => {
            const newSet = new Set(prev);
            newSet.delete(botId);
            return newSet;
          });
          await loadBots();
          alert('✅ Channel detected and configured automatically!');
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);
    
    // Stop polling after 5 minutes
    setTimeout(() => {
      clearInterval(interval);
      setPollingBots(prev => {
        const newSet = new Set(prev);
        newSet.delete(botId);
        return newSet;
      });
    }, 5 * 60 * 1000);
    
    setPollingBots(prev => new Set(prev).add(botId));
  };

  const saveChannel = async (botId: string) => {
    if (!channelId().trim()) {
      setError('Channel ID is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.setBotChannel(botId, channelId().trim());
      setEditingChannel(null);
      setChannelId('');
      await loadBots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set channel');
    } finally {
      setLoading(false);
    }
  };

  const calculateSpeed = (botCount: number) => {
    const uploadSpeed = botCount * 2; // MB/s per bot
    const downloadSpeed = botCount * 3;
    return { uploadSpeed, downloadSpeed };
  };

  const speed = calculateSpeed(bots().length);

  return (
    <div style={{ padding: '40px', 'max-width': '800px', margin: '0 auto' }}>
      <h1 style={{ 'margin-bottom': '30px' }}>Bot Setup</h1>

      <div style={{ 
        background: 'white', 
        padding: '30px', 
        'border-radius': '8px',
        'box-shadow': '0 2px 10px rgba(0,0,0,0.1)',
        'margin-bottom': '30px'
      }}>
        <h2 style={{ 'margin-bottom': '20px' }}>Add Bot</h2>
        
        <ol style={{ 'margin-bottom': '20px', 'padding-left': '20px' }}>
          <li>Open Telegram and search for <code>@BotFather</code></li>
          <li>Send <code>/newbot</code> and follow the instructions</li>
          <li>Copy the bot token and paste it below</li>
        </ol>

        {error() && (
          <div style={{ 
            padding: '10px', 
            background: '#fee', 
            color: '#c33', 
            'border-radius': '4px',
            'margin-bottom': '20px'
          }}>
            {error()}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', 'margin-bottom': '20px' }}>
          <input
            type="text"
            placeholder="Bot token (e.g., 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)"
            value={botToken()}
            onInput={(e) => setBotToken(e.currentTarget.value)}
            style={{
              flex: 1,
              padding: '10px',
              border: '1px solid #ddd',
              'border-radius': '4px'
            }}
          />
          <button
            onClick={addBot}
            disabled={loading()}
            style={{
              padding: '10px 20px',
              background: '#007bff',
              color: 'white',
              border: 'none',
              'border-radius': '4px',
              cursor: loading() ? 'not-allowed' : 'pointer'
            }}
          >
            {loading() ? 'Adding...' : 'Add Bot'}
          </button>
        </div>
      </div>

      <div style={{ 
        background: 'white', 
        padding: '30px', 
        'border-radius': '8px',
        'box-shadow': '0 2px 10px rgba(0,0,0,0.1)',
        'margin-bottom': '30px'
      }}>
        <h2 style={{ 'margin-bottom': '20px' }}>Your Bots ({bots().length})</h2>
        
        {bots().length === 0 ? (
          <p style={{ color: '#999' }}>No bots added yet. Add your first bot above.</p>
        ) : (
          <>
            <div style={{ 
              padding: '15px', 
              background: '#f0f8ff', 
              'border-radius': '4px',
              'margin-bottom': '20px'
            }}>
              <strong>Estimated Speed:</strong> ~{speed.uploadSpeed} MB/s upload, ~{speed.downloadSpeed} MB/s download
            </div>

            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
              {bots().map((bot) => (
                <div key={bot.bot_id} style={{
                  padding: '15px',
                  border: '1px solid #ddd',
                  'border-radius': '4px'
                }}>
                  <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '10px' }}>
                    <div>
                      <strong>{bot.bot_username || 'Unknown'}</strong>
                      <div style={{ 'font-size': '12px', color: '#666' }}>
                        Status: {bot.health_status}
                      </div>
                    </div>
                    <button
                      onClick={() => removeBot(bot.bot_id)}
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
                  
                  {editingChannel() === bot.bot_id ? (
                    <div style={{ display: 'flex', gap: '10px', 'align-items': 'center' }}>
                      <input
                        type="text"
                        placeholder="Channel ID (e.g., -1001234567890)"
                        value={channelId()}
                        onInput={(e) => setChannelId(e.currentTarget.value)}
                        style={{
                          flex: 1,
                          padding: '8px',
                          border: '1px solid #ddd',
                          'border-radius': '4px',
                          'font-size': '14px'
                        }}
                      />
                      <button
                        onClick={() => saveChannel(bot.bot_id)}
                        disabled={loading()}
                        style={{
                          padding: '8px 15px',
                          background: '#28a745',
                          color: 'white',
                          border: 'none',
                          'border-radius': '4px',
                          cursor: loading() ? 'not-allowed' : 'pointer'
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingChannel(null);
                          setChannelId('');
                        }}
                        style={{
                          padding: '8px 15px',
                          background: '#6c757d',
                          color: 'white',
                          border: 'none',
                          'border-radius': '4px',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
                      <div style={{ 'font-size': '13px' }}>
                        {bot.channel_id ? (
                          <span style={{ color: '#28a745' }}>
                            ✓ Storage configured automatically (ID: {bot.channel_id})
                          </span>
                        ) : pollingBots().has(bot.bot_id) ? (
                          <span style={{ color: '#007bff' }}>
                            🔄 Waiting for channel... (Add bot to channel and it will configure automatically)
                          </span>
                        ) : (
                          <span style={{ color: '#dc3545' }}>⚠ Storage not configured</span>
                        )}
                      </div>
                      {!bot.channel_id && (
                        <button
                          onClick={() => startEditingChannel(bot.bot_id, bot.channel_id)}
                          style={{
                            padding: '5px 15px',
                            background: '#007bff',
                            color: 'white',
                            border: 'none',
                            'border-radius': '4px',
                            cursor: 'pointer',
                            'font-size': '12px'
                          }}
                        >
                          Configure Manually
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            {bots().length > 0 && bots().some(b => !b.channel_id) && (
              <div style={{
                padding: '20px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                'border-radius': '8px',
                'margin-top': '20px',
                color: 'white'
              }}>
                <h3 style={{ 'margin-bottom': '15px', color: 'white', 'font-size': '18px' }}>🚀 Automatic Setup (No Manual Configuration Needed!)</h3>
                <div style={{ 'font-size': '14px', 'line-height': '1.8' }}>
                  <p style={{ 'margin-bottom': '15px', 'font-size': '16px' }}>
                    <strong>Just 2 simple steps - the system will configure everything automatically!</strong>
                  </p>
                  
                  <div style={{
                    padding: '15px',
                    background: 'rgba(255,255,255,0.15)',
                    'border-radius': '6px',
                    'margin-bottom': '15px'
                  }}>
                    <p style={{ 'margin-bottom': '10px' }}>
                      <strong>Step 1:</strong> Open Telegram and create a new <strong>Private Channel</strong>
                    </p>
                    <p>
                      <strong>Step 2:</strong> Add <code style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 6px', 'border-radius': '3px' }}>@{bots().find(b => !b.channel_id)?.bot_username || 'YourBot'}</code> as an <strong>Administrator</strong>
                    </p>
                  </div>
                  
                  <div style={{
                    padding: '12px',
                    background: 'rgba(40, 167, 69, 0.3)',
                    'border-radius': '6px',
                    'margin-top': '15px',
                    border: '1px solid rgba(255,255,255,0.3)'
                  }}>
                    <strong>✨ That's it!</strong> The system will automatically detect when you add the bot and configure the channel. No manual Channel ID needed!
                  </div>
                  
                  <div style={{
                    padding: '12px',
                    background: 'rgba(255,255,255,0.1)',
                    'border-radius': '6px',
                    'margin-top': '15px',
                    'font-size': '12px'
                  }}>
                    <strong>💡 Fallback:</strong> If automatic detection doesn't work, you can still configure manually using the "Configure Manually" button above.
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {bots().length > 0 && (
        <div style={{ 'text-align': 'center' }}>
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              padding: '12px 30px',
              background: '#28a745',
              color: 'white',
              border: 'none',
              'border-radius': '4px',
              cursor: 'pointer',
              'font-size': '16px'
            }}
          >
            Continue to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
