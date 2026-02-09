/**
 * Chrome Extension Background Service Worker
 * Handles context menu actions and download interception
 */

const API_BASE = 'http://localhost:8787'; // Set via options page

chrome.runtime.onInstalled.addListener(() => {
  // Create context menu items
  chrome.contextMenus.create({
    id: 'save-image',
    title: 'Save image to InfiniDrive',
    contexts: ['image'],
  });

  chrome.contextMenus.create({
    id: 'save-link',
    title: 'Save link to InfiniDrive',
    contexts: ['link'],
  });

  chrome.contextMenus.create({
    id: 'save-page',
    title: 'Save page to InfiniDrive',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;

  const { auth_token } = await chrome.storage.local.get('auth_token');
  if (!auth_token) {
    chrome.action.openPopup();
    return;
  }

  try {
    if (info.menuItemId === 'save-image' && info.srcUrl) {
      // Download image and upload to InfiniDrive
      const response = await fetch(info.srcUrl);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      const fileName = info.srcUrl.split('/').pop() || 'image.png';
      await uploadToInfiniDrive(arrayBuffer, fileName, blob.type || 'image/png', auth_token);
    } else if (info.menuItemId === 'save-link' && info.linkUrl) {
      // Download linked file
      const response = await fetch(info.linkUrl);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      const fileName = info.linkUrl.split('/').pop() || 'download';
      await uploadToInfiniDrive(arrayBuffer, fileName, blob.type || 'application/octet-stream', auth_token);
    } else if (info.menuItemId === 'save-page' && tab.url) {
      // Save page URL as a bookmark-like entry
      console.log('Save page:', tab.url, tab.title);
      // Could capture page HTML via content script if needed
    }
  } catch (error) {
    console.error('Failed to save to InfiniDrive:', error);
  }
});

/**
 * Upload file to InfiniDrive backend
 * Handles chunking for files > 20MB
 */
async function uploadToInfiniDrive(fileData, fileName, mimeType, token) {
  const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB

  // Hash file (SHA-256)
  const hashBuffer = await crypto.subtle.digest('SHA-256', fileData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Init upload
  const initRes = await fetch(`${API_BASE}/api/files/upload/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      file_name: fileName,
      file_size: fileData.byteLength,
      mime_type: mimeType,
      file_hash: fileHash,
      file_path: `/${fileName}`,
    }),
  });

  if (!initRes.ok) {
    throw new Error('Upload init failed');
  }

  const initData = await initRes.json();

  if (initData.duplicate) {
    console.log('File already exists:', fileName);
    return;
  }

  const { file_id, chunk_count, chunk_size } = initData;

  // Upload chunks
  for (let i = 0; i < chunk_count; i++) {
    const start = i * chunk_size;
    const end = Math.min(start + chunk_size, fileData.byteLength);
    const chunkBuffer = fileData.slice(start, end);

    // Chunk hash
    const chunkHashBuffer = await crypto.subtle.digest('SHA-256', chunkBuffer);
    const chunkHashArray = Array.from(new Uint8Array(chunkHashBuffer));
    const chunkHash = chunkHashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Base64 encode
    const uint8 = new Uint8Array(chunkBuffer);
    let binary = '';
    for (let j = 0; j < uint8.length; j++) {
      binary += String.fromCharCode(uint8[j]);
    }
    const chunkData = btoa(binary);

    const chunkRes = await fetch(`${API_BASE}/api/files/upload/chunk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        file_id,
        chunk_index: i,
        chunk_data: chunkData,
        chunk_hash: chunkHash,
      }),
    });

    if (!chunkRes.ok) {
      throw new Error(`Chunk ${i} upload failed`);
    }
  }

  // Complete upload
  const completeRes = await fetch(`${API_BASE}/api/files/upload/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ file_id }),
  });

  if (!completeRes.ok) {
    throw new Error('Upload complete failed');
  }

  console.log('File uploaded successfully:', fileName);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}
