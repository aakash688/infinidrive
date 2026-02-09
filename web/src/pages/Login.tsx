import { createSignal, onMount, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import api from '../services/api';

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [widgetLoaded, setWidgetLoaded] = createSignal(false);
  const [botUsername, setBotUsername] = createSignal<string | null>(null);

  onMount(async () => {
    // Check if already logged in
    if (api.token) {
      navigate('/dashboard');
      return;
    }

    // Set up Telegram Login Widget callback
    (window as any).onTelegramAuth = (user: any) => {
      handleTelegramLogin(user);
    };

    // Try to get bot username from backend (optional)
    try {
      const response = await fetch(`${api['baseUrl']}/api/auth/bot-username`);
      if (response.ok) {
        const data = await response.json();
        setBotUsername(data.bot_username);
      }
    } catch (err) {
      console.warn('Could not fetch bot username, using default');
    }

    // Use environment variable or default
    const envBotUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
    if (envBotUsername) {
      setBotUsername(envBotUsername);
    } else if (!botUsername()) {
      // Default fallback - users should configure this
      setBotUsername('InfiniDriveAuthBot');
    }

    // Load Telegram Widget script
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.onload = () => {
      setWidgetLoaded(true);
      // Create widget after script loads
      if (botUsername()) {
        createWidget(botUsername()!);
      }
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup
      if ((window as any).onTelegramAuth) {
        delete (window as any).onTelegramAuth;
      }
    };
  });

  const createWidget = (username: string) => {
    const widgetContainer = document.getElementById('telegram-login-widget');
    if (!widgetContainer) return;

    // Clear any existing widget
    widgetContainer.innerHTML = '';
    
    // Create the widget script element
    const widgetScript = document.createElement('script');
    widgetScript.async = true;
    widgetScript.src = 'https://telegram.org/js/telegram-widget.js?22';
    widgetScript.setAttribute('data-telegram-login', username);
    widgetScript.setAttribute('data-size', 'large');
    widgetScript.setAttribute('data-onauth', 'onTelegramAuth(user)');
    widgetScript.setAttribute('data-request-access', 'write');
    
    widgetContainer.appendChild(widgetScript);
  };

  const handleTelegramLogin = async (data: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.telegramLogin(data);
      api.setToken(response.token);
      api.setUser(response.user); // Persist user info for session
      navigate('/setup'); // Go to setup to add storage bots
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      'flex-direction': 'column', 
      'align-items': 'center', 
      'justify-content': 'center',
      'min-height': '100vh',
      padding: '20px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <div style={{ 
        background: 'white', 
        padding: '40px', 
        'border-radius': '12px',
        'box-shadow': '0 4px 20px rgba(0,0,0,0.2)',
        'max-width': '400px',
        width: '100%'
      }}>
        <h1 style={{ 
          'margin-bottom': '10px', 
          'text-align': 'center',
          'font-size': '32px',
          color: '#333'
        }}>
          InfiniDrive
        </h1>
        <p style={{ 
          'margin-bottom': '30px', 
          'text-align': 'center', 
          color: '#666',
          'font-size': '16px'
        }}>
          Unlimited cloud storage powered by Telegram
        </p>

        {error() && (
          <div style={{ 
            padding: '12px', 
            background: '#fee', 
            color: '#c33', 
            'border-radius': '6px',
            'margin-bottom': '20px',
            'font-size': '14px'
          }}>
            {error()}
          </div>
        )}

        {loading() && (
          <div style={{ 
            padding: '20px', 
            'text-align': 'center',
            color: '#666'
          }}>
            Logging in...
          </div>
        )}

        <div 
          id="telegram-login-widget" 
          style={{ 
            'text-align': 'center',
            'min-height': '40px',
            display: loading() ? 'none' : 'block'
          }}
        >
          {!widgetLoaded() && (
            <div style={{ padding: '20px', color: '#999' }}>
              Loading login widget...
            </div>
          )}
        </div>

        <div style={{ 
          'margin-top': '20px', 
          'font-size': '13px', 
          color: '#999',
          'text-align': 'center',
          'line-height': '1.5'
        }}>
          <p style={{ margin: '10px 0' }}>
            By logging in, you agree to use your own Telegram bots for storage.
          </p>
          <p style={{ margin: '10px 0', 'font-size': '12px' }}>
            Don't have an auth bot? Create one via @BotFather and configure it in the backend.
          </p>
        </div>
      </div>
    </div>
  );
}
