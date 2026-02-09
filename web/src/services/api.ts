/**
 * API Client Service
 * Wraps all backend API endpoints
 */

const API_BASE = import.meta.env.VITE_API_URL || (
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8787'
    : 'https://infinidrive-backend.infinidrive.workers.dev'
);

interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

class ApiClient {
  baseUrl: string;
  token: string | null = null;
  user: any = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Load token and user from localStorage (persistent login)
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
      const userStr = localStorage.getItem('user_info');
      if (userStr) {
        try { this.user = JSON.parse(userStr); } catch { this.user = null; }
      }
    }
  }

  setToken(token: string | null) {
    this.token = token;
    if (token && typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    } else if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
  }

  setUser(user: any) {
    this.user = user;
    if (user && typeof window !== 'undefined') {
      localStorage.setItem('user_info', JSON.stringify(user));
    } else if (typeof window !== 'undefined') {
      localStorage.removeItem('user_info');
    }
  }

  clearSession() {
    this.token = null;
    this.user = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_info');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || error.message || 'Request failed');
    }

    return response.json();
  }

  // Auth
  async getBotUsername() {
    return this.request<{ bot_username: string; message?: string }>('/api/auth/bot-username');
  }

  async telegramLogin(data: any) {
    return this.request<{ token: string; user: any }>('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async generateQR() {
    return this.request<{ session_id: string; qr_data: string; expires_at: number }>('/api/auth/qr/generate', {
      method: 'POST',
    });
  }

  async approveQR(session_id: string) {
    return this.request<{ success: boolean; token: string }>('/api/auth/qr/approve', {
      method: 'POST',
      body: JSON.stringify({ session_id }),
    });
  }

  async checkQRStatus(session_id: string) {
    return this.request<{ status: string; message: string }>(`/api/auth/qr/status/${session_id}`);
  }

  async logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  }

  // Bots
  async addBot(bot_token: string) {
    return this.request('/api/bots/add', {
      method: 'POST',
      body: JSON.stringify({ bot_token }),
    });
  }

  async listBots() {
    return this.request<{ bots: any[] }>('/api/bots/list');
  }

  async removeBot(bot_id: string) {
    return this.request(`/api/bots/${bot_id}`, { method: 'DELETE' });
  }

  async checkBotHealth(bot_id: string) {
    return this.request(`/api/bots/${bot_id}/health`, { method: 'POST' });
  }

  async setBotChannel(bot_id: string, channel_id: string) {
    return this.request(`/api/bots/${bot_id}/channel`, {
      method: 'PUT',
      body: JSON.stringify({ channel_id }),
    });
  }

  // Devices
  async listDevices() {
    return this.request<{ devices: any[] }>('/api/devices/list');
  }

  async updateDevice(device_id: string, device_name: string) {
    return this.request(`/api/devices/${device_id}`, {
      method: 'PUT',
      body: JSON.stringify({ device_name }),
    });
  }

  async registerDevice(device: any) {
    return this.request('/api/devices/register', {
      method: 'POST',
      body: JSON.stringify(device),
    });
  }

  // Files
  async initUpload(fileData: any) {
    return this.request('/api/files/upload/init', {
      method: 'POST',
      body: JSON.stringify(fileData),
    });
  }

  // Folders
  async createFolder(folder_name: string, parent_folder_id?: string) {
    return this.request('/api/folders/create', {
      method: 'POST',
      body: JSON.stringify({ folder_name, parent_folder_id }),
    });
  }

  async listFolders(parent_folder_id?: string) {
    const query = parent_folder_id ? `?parent_folder_id=${parent_folder_id}` : '';
    return this.request<{ folders: any[]; total: number }>(`/api/folders/list${query}`);
  }

  async getFolderTree() {
    return this.request<{ tree: any[] }>('/api/folders/tree');
  }

  async updateFolder(folder_id: string, updates: any) {
    return this.request(`/api/folders/${folder_id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteFolder(folder_id: string, move_files_to_parent: boolean = false) {
    return this.request(`/api/folders/${folder_id}`, {
      method: 'DELETE',
      body: JSON.stringify({ move_files_to_parent }),
    });
  }

  async uploadChunk(chunkData: any) {
    return this.request('/api/files/upload/chunk', {
      method: 'POST',
      body: JSON.stringify(chunkData),
    });
  }

  async completeUpload(file_id: string) {
    return this.request('/api/files/upload/complete', {
      method: 'POST',
      body: JSON.stringify({ file_id }),
    });
  }

  async listFiles(params?: any) {
    const query = new URLSearchParams(params).toString();
    return this.request<{ files: any[]; total: number }>(`/api/files/list?${query}`);
  }

  async getFile(file_id: string) {
    return this.request(`/api/files/${file_id}`);
  }

  async deleteFile(file_id: string) {
    return this.request(`/api/files/${file_id}`, { method: 'DELETE' });
  }

  async updateFile(file_id: string, updates: any) {
    return this.request(`/api/files/${file_id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  getStreamUrl(file_id: string): string {
    const base = `${this.baseUrl}/api/files/${file_id}/stream`;
    return this.token ? `${base}?token=${encodeURIComponent(this.token)}` : base;
  }

  getDownloadUrl(file_id: string): string {
    const base = `${this.baseUrl}/api/files/${file_id}/download`;
    return this.token ? `${base}?token=${encodeURIComponent(this.token)}` : base;
  }

  // Share
  async createShare(file_id: string, options?: any) {
    return this.request('/api/share/create', {
      method: 'POST',
      body: JSON.stringify({ file_id, ...options }),
    });
  }

  async getShare(share_id: string) {
    return this.request(`/api/share/${share_id}`);
  }

  async revokeShare(share_id: string) {
    return this.request(`/api/share/${share_id}`, { method: 'DELETE' });
  }

  getShareStreamUrl(share_id: string, password?: string): string {
    const base = `${this.baseUrl}/api/share/${share_id}/stream`;
    return password ? `${base}?password=${encodeURIComponent(password)}` : base;
  }

  getShareDownloadUrl(share_id: string, password?: string): string {
    const base = `${this.baseUrl}/api/share/${share_id}/download`;
    return password ? `${base}?password=${encodeURIComponent(password)}` : base;
  }

  // Community
  async listCommunityFiles(params?: any) {
    const query = new URLSearchParams(params).toString();
    return this.request<{ files: any[]; total: number }>(`/api/community/files?${query}`);
  }

  async forkFile(file_id: string) {
    return this.request(`/api/community/${file_id}/fork`, { method: 'POST' });
  }

  async viewFile(file_id: string) {
    return this.request(`/api/community/${file_id}/view`, { method: 'POST' });
  }

  // Backup
  async saveBackupConfig(config: any) {
    return this.request('/api/backup/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async getBackupConfig(device_id: string) {
    return this.request<{ configs: any[] }>(`/api/backup/config/${device_id}`);
  }

  async checkBackup(device_id: string, file_hashes: string[]) {
    return this.request('/api/backup/check', {
      method: 'POST',
      body: JSON.stringify({ device_id, file_hashes }),
    });
  }

  // Stats
  async getStats() {
    return this.request('/api/stats');
  }

  // Projects
  async createProject(project_name: string, description?: string) {
    return this.request('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ project_name, description }),
    });
  }

  async listProjects() {
    return this.request<{ projects: any[] }>('/api/projects/list');
  }

  async getProject(project_id: string) {
    return this.request(`/api/projects/${project_id}`);
  }

  async updateProject(project_id: string, updates: any) {
    return this.request(`/api/projects/${project_id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteProject(project_id: string) {
    return this.request(`/api/projects/${project_id}`, { method: 'DELETE' });
  }

  // API Keys
  async createApiKey(data: { project_id: string; key_name: string; permissions?: string; expires_in_days?: number }) {
    return this.request('/api/keys/create', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listApiKeys(project_id?: string) {
    const query = project_id ? `?project_id=${project_id}` : '';
    return this.request<{ keys: any[] }>(`/api/keys/list${query}`);
  }

  async revokeApiKey(key_id: string) {
    return this.request(`/api/keys/${key_id}`, { method: 'DELETE' });
  }
}

export const api = new ApiClient(API_BASE);
export default api;
