/**
 * InfiniDrive Chrome Extension Popup
 * Handles login, stats display, and quick upload
 */

const API_BASE = 'http://localhost:8787'; // Configure via options

document.addEventListener('DOMContentLoaded', async () => {
  const loginDiv = document.getElementById('login');
  const dashboardDiv = document.getElementById('dashboard');
  const loginBtn = document.getElementById('loginBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const statsDiv = document.getElementById('stats');

  // Check if logged in
  const { auth_token } = await chrome.storage.local.get('auth_token');

  if (auth_token) {
    loginDiv.style.display = 'none';
    dashboardDiv.style.display = 'block';
    await loadStats(auth_token, statsDiv);
  } else {
    loginDiv.style.display = 'block';
    dashboardDiv.style.display = 'none';
  }

  // Login button
  loginBtn.addEventListener('click', () => {
    // Open web login page in new tab
    chrome.tabs.create({ url: `${API_BASE.replace(':8787', ':3000')}/` });
  });

  // Upload button
  uploadBtn.addEventListener('click', () => {
    // Open file picker
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      statsDiv.innerHTML = '<p>Uploading...</p>';
      try {
        const { auth_token: token } = await chrome.storage.local.get('auth_token');
        if (!token) {
          statsDiv.innerHTML = '<p style="color:red">Not logged in</p>';
          return;
        }
        // For now, show file info - full upload would chunk and send
        statsDiv.innerHTML = `<p>Selected: ${file.name} (${formatBytes(file.size)})</p><p>Upload via web panel for now.</p>`;
      } catch (err) {
        statsDiv.innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
      }
    };
    input.click();
  });

  // Logout button
  logoutBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('auth_token');
    loginDiv.style.display = 'block';
    dashboardDiv.style.display = 'none';
  });
});

async function loadStats(token, statsDiv) {
  try {
    const response = await fetch(`${API_BASE}/api/stats`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      statsDiv.innerHTML = '<p style="color:red">Failed to load stats</p>';
      return;
    }

    const stats = await response.json();
    statsDiv.innerHTML = `
      <div style="margin-bottom:10px">
        <strong>Files:</strong> ${stats.total_files || 0}
      </div>
      <div style="margin-bottom:10px">
        <strong>Storage:</strong> ${formatBytes(stats.total_size || 0)}
      </div>
      <div style="margin-bottom:10px">
        <strong>Devices:</strong> ${stats.total_devices || 0}
      </div>
      <div>
        <strong>Bots:</strong> ${stats.total_bots || 0}
      </div>
    `;
  } catch (err) {
    statsDiv.innerHTML = '<p style="color:red">Failed to connect</p>';
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}
