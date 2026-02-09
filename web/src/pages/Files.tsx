import { createSignal, onMount, onCleanup, Show, For, createEffect, createMemo } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import api from '../services/api';

// ============================================
// TYPE DEFINITIONS
// ============================================
interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}
interface ContextMenuState {
  x: number;
  y: number;
  type: 'file' | 'folder' | 'empty';
  target?: any;
}

// ============================================
// FILE MANAGER COMPONENT
// ============================================
export default function Files() {
  const navigate = useNavigate();

  // ---- Core State ----
  const [files, setFiles] = createSignal<any[]>([]);
  const [folders, setFolders] = createSignal<any[]>([]);
  const [folderTree, setFolderTree] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [currentFolderId, setCurrentFolderId] = createSignal<string | null>(null);
  const [folderPath, setFolderPath] = createSignal<any[]>([{ id: null, name: 'My Drive' }]);

  // ---- UI State ----
  const [searchQuery, setSearchQuery] = createSignal('');
  const [viewMode, setViewMode] = createSignal<'grid' | 'list'>('list');
  const [sortBy, setSortBy] = createSignal<'name' | 'date' | 'size'>('date');
  const [sortDir, setSortDir] = createSignal<'asc' | 'desc'>('desc');
  const [filterType, setFilterType] = createSignal<string>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(new Set());
  const [userMenuOpen, setUserMenuOpen] = createSignal(false);

  // ---- Upload State ----
  const [uploading, setUploading] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal(0);
  const [uploadSpeed, setUploadSpeed] = createSignal(0);
  const [uploadETA, setUploadETA] = createSignal('');
  const [currentUploadFile, setCurrentUploadFile] = createSignal('');
  const [uploadedBytes, setUploadedBytes] = createSignal(0);
  const [totalUploadBytes, setTotalUploadBytes] = createSignal(0);
  const [isDragOver, setIsDragOver] = createSignal(false);

  // ---- Dialog State ----
  const [showCreateFolder, setShowCreateFolder] = createSignal(false);
  const [newFolderName, setNewFolderName] = createSignal('');
  const [shareDialog, setShareDialog] = createSignal<any>(null);
  const [shareResult, setShareResult] = createSignal<any>(null);
  const [sharePassword, setSharePassword] = createSignal('');
  const [shareExpiry, setShareExpiry] = createSignal('');
  const [moveDialog, setMoveDialog] = createSignal<{ item: any; type: 'file' | 'folder'; show: boolean }>({ item: null, type: 'file', show: false });
  const [renameDialog, setRenameDialog] = createSignal<{ item: any; show: boolean; newName: string; type: 'file' | 'folder' }>({ item: null, show: false, newName: '', type: 'file' });

  // ---- Toast & Context Menu ----
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  let toastCounter = 0;

  // ============================================
  // HELPERS
  // ============================================
  const addToast = (message: string, type: Toast['type'] = 'info') => {
    const id = ++toastCounter;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  };

  const formatSpeed = (bps: number) => {
    if (bps === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bps) / Math.log(k));
    return Math.round(bps / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return '...';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const getFileIcon = (mimeType: string | null, size: 'sm' | 'md' | 'lg' = 'md') => {
    const sizeMap = { sm: '20px', md: '28px', lg: '48px' };
    const s = sizeMap[size];
    if (!mimeType) return <div style={{ 'font-size': s, 'line-height': '1' }}>📄</div>;
    if (mimeType.startsWith('image/')) return <div style={{ 'font-size': s, 'line-height': '1' }}>🖼️</div>;
    if (mimeType.startsWith('video/')) return <div style={{ 'font-size': s, 'line-height': '1' }}>🎬</div>;
    if (mimeType.startsWith('audio/')) return <div style={{ 'font-size': s, 'line-height': '1' }}>🎵</div>;
    if (mimeType.includes('pdf')) return <div style={{ 'font-size': s, 'line-height': '1', color: '#ef4444' }}>📕</div>;
    if (mimeType.includes('word') || mimeType.includes('document')) return <div style={{ 'font-size': s, 'line-height': '1', color: '#3b82f6' }}>📝</div>;
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return <div style={{ 'font-size': s, 'line-height': '1', color: '#10b981' }}>📊</div>;
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('rar')) return <div style={{ 'font-size': s, 'line-height': '1' }}>📦</div>;
    if (mimeType.includes('text')) return <div style={{ 'font-size': s, 'line-height': '1' }}>📃</div>;
    return <div style={{ 'font-size': s, 'line-height': '1' }}>📄</div>;
  };

  const getMimeCategory = (mimeType: string | null) => {
    if (!mimeType) return 'Other';
    if (mimeType.startsWith('image/')) return 'Image';
    if (mimeType.startsWith('video/')) return 'Video';
    if (mimeType.startsWith('audio/')) return 'Audio';
    if (mimeType.includes('pdf')) return 'PDF';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'Document';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return 'Archive';
    return 'Other';
  };

  // ============================================
  // DATA LOADING
  // ============================================
  const loadData = async (folderId?: string | null, search?: string) => {
    try {
      const params: any = {};
      if (folderId !== undefined && folderId !== null) params.folder_id = folderId;
      if (search && search.trim()) params.search = search.trim();
      if (filterType() !== 'all') params.mime_type = filterType();

      const [filesRes, foldersRes] = await Promise.all([
        api.listFiles(params),
        api.listFolders(folderId || undefined)
      ]);
      setFiles(filesRes.files || []);
      setFolders(foldersRes.folders || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      addToast('Failed to load files', 'error');
    }
  };

  const loadFolderTree = async () => {
    try {
      const res = await api.getFolderTree();
      setFolderTree(res.tree || []);
    } catch (err) {
      console.error('Failed to load folder tree:', err);
    }
  };

  const buildBreadcrumb = async (folderId: string | null) => {
    if (!folderId) {
      setFolderPath([{ id: null, name: 'My Drive' }]);
      return;
    }
    try {
      const tree = await api.getFolderTree();
      const findPath = (nodes: any[], targetId: string, path: any[] = []): any[] | null => {
        for (const node of nodes) {
          const np = [...path, { id: node.folder_id, name: node.folder_name }];
          if (node.folder_id === targetId) return np;
          if (node.children?.length > 0) {
            const found = findPath(node.children, targetId, np);
            if (found) return found;
          }
        }
        return null;
      };
      const path = findPath(tree.tree || [], folderId);
      setFolderPath([{ id: null, name: 'My Drive' }, ...(path || [])]);
    } catch {
      setFolderPath([{ id: null, name: 'My Drive' }]);
    }
  };

  // Search debounce
  let searchTimer: any;
  createEffect(() => {
    const query = searchQuery();
    clearTimeout(searchTimer);
    if (query.trim()) {
      searchTimer = setTimeout(() => loadData(undefined, query), 300);
    } else {
      loadData(currentFolderId());
    }
  });

  onMount(async () => {
    if (!api.token) {
      navigate('/');
      return;
    }
    try {
      await Promise.all([loadData(null), loadFolderTree()]);
    } catch (err) {
      console.error('Init error:', err);
    } finally {
      setLoading(false);
    }

    // Global click to close menus
    const handleClick = () => {
      setContextMenu(null);
      setUserMenuOpen(false);
    };
    document.addEventListener('click', handleClick);
    onCleanup(() => document.removeEventListener('click', handleClick));

    // Global keyboard shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setShareDialog(null);
        setMoveDialog({ item: null, type: 'file', show: false });
        setRenameDialog({ item: null, show: false, newName: '', type: 'file' });
        setShowCreateFolder(false);
        setSelectedFiles(new Set());
      }
    };
    document.addEventListener('keydown', handleKeydown);
    onCleanup(() => document.removeEventListener('keydown', handleKeydown));
  });

  // ============================================
  // NAVIGATION
  // ============================================
  const navigateToFolder = async (folderId: string | null, folderName?: string) => {
    setCurrentFolderId(folderId);
    setSearchQuery('');
    setSelectedFiles(new Set());
    await buildBreadcrumb(folderId);
    await loadData(folderId);
  };

  const toggleTreeFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // ============================================
  // SORTING & FILTERING
  // ============================================
  const sortedFiles = createMemo(() => {
    let sorted = [...files()];
    const dir = sortDir() === 'asc' ? 1 : -1;
    switch (sortBy()) {
      case 'name':
        sorted.sort((a, b) => dir * a.file_name.localeCompare(b.file_name));
        break;
      case 'size':
        sorted.sort((a, b) => dir * (a.file_size - b.file_size));
        break;
      case 'date':
      default:
        sorted.sort((a, b) => dir * (a.created_at - b.created_at));
        break;
    }
    return sorted;
  });

  const totalSize = createMemo(() => files().reduce((sum, f) => sum + (f.file_size || 0), 0));

  // ============================================
  // FILE ACTIONS
  // ============================================
  const copyDirectLink = (file: any) => {
    const url = api.getStreamUrl(file.file_id);
    navigator.clipboard.writeText(url).then(() => {
      addToast(`Link copied for "${file.file_name}"`, 'success');
    }).catch(() => {
      addToast('Failed to copy link', 'error');
    });
  };

  const copyDownloadLink = (file: any) => {
    const url = api.getDownloadUrl(file.file_id);
    navigator.clipboard.writeText(url).then(() => {
      addToast(`Download link copied for "${file.file_name}"`, 'success');
    }).catch(() => {
      addToast('Failed to copy link', 'error');
    });
  };

  const deleteFile = async (file_id: string, file_name: string) => {
    if (!confirm(`Delete "${file_name}"? This cannot be undone.`)) return;
    try {
      await api.deleteFile(file_id);
      addToast(`"${file_name}" deleted`, 'success');
      await loadData(currentFolderId());
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete', 'error');
    }
  };

  const createFolder = async () => {
    const name = newFolderName().trim();
    if (!name) return;
    try {
      await api.createFolder(name, currentFolderId() || undefined);
      setNewFolderName('');
      setShowCreateFolder(false);
      addToast(`Folder "${name}" created`, 'success');
      await Promise.all([loadData(currentFolderId()), loadFolderTree()]);
    } catch (err: any) {
      addToast(err.message || 'Failed to create folder', 'error');
    }
  };

  const deleteFolder = async (folderId: string, folderName: string) => {
    if (!confirm(`Delete folder "${folderName}"? Files will be moved to parent folder.`)) return;
    try {
      await api.deleteFolder(folderId, true);
      addToast(`Folder "${folderName}" deleted`, 'success');
      await Promise.all([loadData(currentFolderId()), loadFolderTree()]);
    } catch (err: any) {
      addToast(err.message || 'Failed to delete folder', 'error');
    }
  };

  const renameItem = async () => {
    const d = renameDialog();
    if (!d.item || !d.newName.trim()) return;
    try {
      if (d.type === 'file') {
        await api.updateFile(d.item.file_id, { file_name: d.newName.trim() });
      } else {
        await api.updateFolder(d.item.folder_id, { folder_name: d.newName.trim() });
      }
      setRenameDialog({ item: null, show: false, newName: '', type: 'file' });
      addToast('Renamed successfully', 'success');
      await Promise.all([loadData(currentFolderId()), loadFolderTree()]);
    } catch (err: any) {
      addToast(err.message || 'Failed to rename', 'error');
    }
  };

  const moveFileToFolder = async (targetFolderId: string | null) => {
    const d = moveDialog();
    if (!d.item) return;
    try {
      await api.updateFile(d.item.file_id, { folder_id: targetFolderId });
      setMoveDialog({ item: null, type: 'file', show: false });
      addToast('File moved successfully', 'success');
      await loadData(currentFolderId());
    } catch (err: any) {
      addToast(err.message || 'Failed to move file', 'error');
    }
  };

  const openShareDialog = (file: any) => {
    setShareDialog(file);
    setShareResult(null);
    setSharePassword('');
    setShareExpiry('');
  };

  const createShareLink = async () => {
    const file = shareDialog();
    if (!file) return;
    try {
      const options: any = {};
      if (sharePassword()) options.password = sharePassword();
      if (shareExpiry()) options.expires_at = shareExpiry();
      const result = await api.createShare(file.file_id, options);
      setShareResult(result);
      addToast('Share link created!', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create share link', 'error');
    }
  };

  const copyShareLink = () => {
    const result = shareResult();
    if (result) {
      const url = `${window.location.origin}/s/${result.share_id}`;
      navigator.clipboard.writeText(url).then(() => addToast('Share link copied!', 'success'));
    }
  };

  const toggleFileSelection = (fileId: string, e?: MouseEvent) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const selectAllFiles = () => {
    if (selectedFiles().size === files().length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files().map(f => f.file_id)));
    }
  };

  const deleteSelected = async () => {
    const selected = selectedFiles();
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected file(s)?`)) return;
    for (const fileId of selected) {
      try { await api.deleteFile(fileId); } catch {}
    }
    setSelectedFiles(new Set());
    addToast(`${selected.size} file(s) deleted`, 'success');
    await loadData(currentFolderId());
  };

  // ============================================
  // CONTEXT MENU
  // ============================================
  const handleContextMenu = (e: MouseEvent, type: 'file' | 'folder' | 'empty', target?: any) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type, target });
  };

  // ============================================
  // UPLOAD HANDLER
  // ============================================
  const handleUpload = async (fileList: FileList) => {
    if (fileList.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadSpeed(0);
    setUploadETA('');
    setUploadedBytes(0);
    setTotalUploadBytes(0);

    let totalSize = 0;
    for (let i = 0; i < fileList.length; i++) totalSize += fileList[i].size;
    setTotalUploadBytes(totalSize);

    let totalUploaded = 0;
    const speedHistory: number[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setCurrentUploadFile(file.name);

      try {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const file_hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        const initRes: any = await api.initUpload({
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
          file_hash,
          file_path: `/${file.name}`,
          folder_id: currentFolderId() || undefined,
        });

        if (initRes.duplicate) {
          addToast(`"${file.name}" already exists`, 'warning');
          totalUploaded += file.size;
          setUploadedBytes(totalUploaded);
          continue;
        }

        const { file_id, chunk_count, chunk_size } = initRes;
        const maxParallel = Math.min(3, chunk_count);
        const chunkPromises: Promise<void>[] = [];

        for (let chunkIdx = 0; chunkIdx < chunk_count; chunkIdx++) {
          const start = chunkIdx * chunk_size;
          const end = Math.min(start + chunk_size, file.size);
          const chunkBuffer = buffer.slice(start, end);
          const chunkLen = chunkBuffer.byteLength;

          const chunkHashBuffer = await crypto.subtle.digest('SHA-256', chunkBuffer);
          const chunkHashArray = Array.from(new Uint8Array(chunkHashBuffer));
          const chunk_hash = chunkHashArray.map(b => b.toString(16).padStart(2, '0')).join('');

          const uint8 = new Uint8Array(chunkBuffer);
          let binary = '';
          for (let j = 0; j < uint8.length; j++) binary += String.fromCharCode(uint8[j]);
          const chunk_data = btoa(binary);

          const uploadPromise = (async () => {
            const t0 = Date.now();
            await api.uploadChunk({ file_id, chunk_index: chunkIdx, chunk_data, chunk_hash });
            const elapsed = (Date.now() - t0) / 1000;
            const speed = chunkLen / elapsed;
            speedHistory.push(speed);
            if (speedHistory.length > 5) speedHistory.shift();
            const avgSpeed = speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
            setUploadSpeed(avgSpeed);

            totalUploaded += chunkLen;
            setUploadedBytes(totalUploaded);
            setUploadProgress(Math.round((totalUploaded / totalSize) * 100));

            const remaining = totalSize - totalUploaded;
            if (avgSpeed > 0) setUploadETA(formatTime(remaining / avgSpeed));
          })();

          chunkPromises.push(uploadPromise);
          if (chunkPromises.length >= maxParallel || chunkIdx === chunk_count - 1) {
            await Promise.all(chunkPromises);
            chunkPromises.length = 0;
          }
        }

        await api.completeUpload(file_id);
        addToast(`"${file.name}" uploaded successfully`, 'success');
      } catch (err) {
        console.error(`Upload error for ${file.name}:`, err);
        addToast(`Failed to upload "${file.name}"`, 'error');
        totalUploaded += file.size;
        setUploadedBytes(totalUploaded);
      }
    }

    setUploading(false);
    setUploadProgress(0);
    setUploadSpeed(0);
    setUploadETA('');
    setCurrentUploadFile('');
    setUploadedBytes(0);
    setTotalUploadBytes(0);
    await Promise.all([loadData(currentFolderId()), loadFolderTree()]);
  };

  const triggerUpload = () => {
    if (uploading()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => { if (input.files) handleUpload(input.files); };
    input.click();
  };

  // Drag & Drop on window
  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: DragEvent) => {
    if (e.relatedTarget === null || !(e.currentTarget as HTMLElement)?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer?.files) handleUpload(e.dataTransfer.files);
  };

  // Logout
  const handleLogout = () => {
    api.clearSession();
    navigate('/');
  };

  // ============================================
  // TREE RENDERING
  // ============================================
  const renderTreeNodes = (nodes: any[], level: number = 0): any => {
    return nodes.map(node => {
      const hasChildren = node.children && node.children.length > 0;
      const isExpanded = expandedFolders().has(node.folder_id);
      const isActive = currentFolderId() === node.folder_id;

      return (
        <>
          <div
            class={`fm-tree-item ${isActive ? 'active' : ''}`}
            style={{ 'padding-left': `${12 + level * 18}px` }}
            onClick={(e) => {
              e.stopPropagation();
              navigateToFolder(node.folder_id, node.folder_name);
              if (hasChildren && !isExpanded) toggleTreeFolder(node.folder_id);
            }}
            onContextMenu={(e) => handleContextMenu(e, 'folder', node)}
          >
            {hasChildren ? (
              <span
                class={`fm-tree-toggle ${isExpanded ? 'expanded' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleTreeFolder(node.folder_id); }}
              >
                ▶
              </span>
            ) : (
              <span style={{ width: '16px', 'flex-shrink': 0 }}></span>
            )}
            <span style={{ 'font-size': '14px' }}>📁</span>
            <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis' }}>{node.folder_name}</span>
          </div>
          {hasChildren && isExpanded && renderTreeNodes(node.children, level + 1)}
        </>
      );
    });
  };

  const flattenTree = (nodes: any[], level: number = 0): any[] => {
    const result: any[] = [];
    for (const node of nodes) {
      result.push({ ...node, level });
      if (node.children?.length > 0) result.push(...flattenTree(node.children, level + 1));
    }
    return result;
  };

  // ============================================
  // RENDER
  // ============================================
  return (
    <div
      style={{ display: 'flex', 'flex-direction': 'column', height: '100vh', overflow: 'hidden' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ===== TOAST NOTIFICATIONS ===== */}
      <div class="fm-toast-container">
        <For each={toasts()}>
          {(toast) => (
            <div class={`fm-toast ${toast.type}`}>
              {toast.type === 'success' && '✓'}
              {toast.type === 'error' && '✕'}
              {toast.type === 'info' && 'ℹ'}
              {toast.type === 'warning' && '⚠'}
              {toast.message}
            </div>
          )}
        </For>
      </div>

      {/* ===== DRAG OVERLAY ===== */}
      <Show when={isDragOver()}>
        <div class="fm-drop-overlay">
          <div style={{ 'text-align': 'center', color: 'var(--primary)' }}>
            <div style={{ 'font-size': '56px', 'margin-bottom': '16px' }}>📤</div>
            <div style={{ 'font-size': '20px', 'font-weight': '600' }}>Drop files to upload</div>
            <div style={{ 'font-size': '14px', color: 'var(--text-muted)', 'margin-top': '8px' }}>
              Files will be uploaded to the current folder
            </div>
          </div>
        </div>
      </Show>

      {/* ===== HEADER ===== */}
      <header style={{
        height: '56px',
        background: 'var(--surface)',
        'border-bottom': '1px solid var(--border)',
        display: 'flex',
        'align-items': 'center',
        padding: '0 20px',
        gap: '20px',
        'flex-shrink': 0,
        'z-index': 100,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', 'min-width': '200px' }}>
          <button
            class="fm-btn-icon"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed())}
            title="Toggle sidebar"
          >
            <span style={{ 'font-size': '18px' }}>☰</span>
          </button>
          <a href="/dashboard" style={{ 'text-decoration': 'none', display: 'flex', 'align-items': 'center', gap: '8px' }}>
            <span style={{ 'font-size': '22px' }}>♾️</span>
            <span style={{ 'font-weight': '700', 'font-size': '18px', color: 'var(--text)', 'letter-spacing': '-0.5px' }}>InfiniDrive</span>
          </a>
        </div>

        {/* Search */}
        <div style={{ flex: 1, 'max-width': '600px' }}>
          <input
            class="fm-input fm-input-search"
            type="text"
            placeholder="Search files and folders..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-left': 'auto' }}>
          <button class="fm-btn fm-btn-primary" onClick={triggerUpload} disabled={uploading()}>
            ⬆ Upload
          </button>

          {/* User Menu */}
          <div style={{ position: 'relative' }}>
            <button
              class="fm-btn-icon"
              onClick={(e) => { e.stopPropagation(); setUserMenuOpen(!userMenuOpen()); }}
              style={{
                width: '36px',
                height: '36px',
                'border-radius': '50%',
                background: 'var(--primary-light)',
                color: 'var(--primary)',
                'font-weight': '700',
                'font-size': '14px',
              }}
            >
              {api.user?.first_name?.[0] || api.user?.username?.[0]?.toUpperCase() || '?'}
            </button>
            <Show when={userMenuOpen()}>
              <div class="fm-dropdown" onClick={(e) => e.stopPropagation()}>
                <div style={{ padding: '12px 16px', 'border-bottom': '1px solid var(--border)' }}>
                  <div style={{ 'font-weight': '600', 'font-size': '14px' }}>
                    {api.user?.first_name || 'User'} {api.user?.last_name || ''}
                  </div>
                  <div style={{ 'font-size': '12px', color: 'var(--text-muted)' }}>
                    @{api.user?.username || 'unknown'}
                  </div>
                </div>
                <a href="/dashboard" class="fm-dropdown-item">📊 Dashboard</a>
                <a href="/community" class="fm-dropdown-item">🌐 Community</a>
                <a href="/settings" class="fm-dropdown-item">⚙️ Settings</a>
                <div class="fm-dropdown-sep"></div>
                <button class="fm-dropdown-item" style={{ color: 'var(--danger)' }} onClick={handleLogout}>
                  🚪 Logout
                </button>
              </div>
            </Show>
          </div>
        </div>
      </header>

      {/* ===== BODY (Sidebar + Main) ===== */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ===== SIDEBAR ===== */}
        <Show when={!sidebarCollapsed()}>
          <aside style={{
            width: '260px',
            background: 'var(--sidebar-bg)',
            'flex-shrink': 0,
            display: 'flex',
            'flex-direction': 'column',
            overflow: 'hidden',
          }}>
            {/* Navigation */}
            <div style={{ padding: '12px 0 8px' }}>
              <a href="/files" class="fm-nav-item active">
                <span>📁</span> My Drive
              </a>
              <a href="/community" class="fm-nav-item">
                <span>🌐</span> Community
              </a>
              <a href="/dashboard" class="fm-nav-item">
                <span>📊</span> Dashboard
              </a>
              <a href="/settings" class="fm-nav-item">
                <span>⚙️</span> Settings
              </a>
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 16px' }}></div>

            {/* Folder Tree */}
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
              <div style={{ padding: '4px 20px 8px', 'font-size': '11px', 'text-transform': 'uppercase', 'letter-spacing': '0.5px', color: 'rgba(148,163,184,0.6)', 'font-weight': '600' }}>
                Folders
              </div>
              <div
                class={`fm-tree-item ${currentFolderId() === null ? 'active' : ''}`}
                style={{ 'padding-left': '12px' }}
                onClick={() => navigateToFolder(null)}
              >
                <span style={{ width: '16px', 'flex-shrink': 0 }}></span>
                <span style={{ 'font-size': '14px' }}>🏠</span>
                <span>Root</span>
              </div>
              {renderTreeNodes(folderTree())}

              <Show when={folderTree().length === 0 && !loading()}>
                <div style={{ padding: '12px 20px', 'font-size': '12px', color: 'rgba(148,163,184,0.5)', 'font-style': 'italic' }}>
                  No folders yet
                </div>
              </Show>
            </div>

            {/* Quick Links */}
            <div style={{
              padding: '8px 12px',
              'border-top': '1px solid rgba(255,255,255,0.06)',
            }}>
              <a href="/api" style={{
                display: 'flex', 'align-items': 'center', gap: '8px', padding: '8px 10px',
                color: 'var(--sidebar-text)', 'text-decoration': 'none', 'font-size': '13px',
                'border-radius': '6px', transition: 'background 0.15s',
              }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                 onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <span>🔑</span> <span>API & Projects</span>
              </a>
            </div>

            {/* Storage Info */}
            <div style={{
              padding: '16px',
              'border-top': '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ 'font-size': '12px', color: 'var(--sidebar-text)', 'margin-bottom': '6px' }}>
                Storage Used
              </div>
              <div style={{ 'font-size': '18px', 'font-weight': '700', color: 'white', 'margin-bottom': '8px' }}>
                {formatBytes(totalSize())}
              </div>
              <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', 'border-radius': '2px', overflow: 'hidden' }}>
                <div style={{ width: '100%', height: '100%', background: 'var(--primary)', 'border-radius': '2px' }}></div>
              </div>
              <div style={{ 'font-size': '11px', color: 'rgba(148,163,184,0.5)', 'margin-top': '4px' }}>
                ♾️ Unlimited storage
              </div>
            </div>
          </aside>
        </Show>

        {/* ===== MAIN CONTENT ===== */}
        <main style={{ flex: 1, display: 'flex', 'flex-direction': 'column', overflow: 'hidden', background: 'var(--bg)' }}>

          {/* Upload Progress Bar (sticky) */}
          <Show when={uploading()}>
            <div style={{
              background: 'var(--surface)',
              'border-bottom': '1px solid var(--border)',
              padding: '12px 20px',
            }}>
              <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '8px' }}>
                <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                  <div style={{
                    width: '28px', height: '28px', 'border-radius': '50%',
                    background: 'var(--primary-light)', display: 'flex', 'align-items': 'center',
                    'justify-content': 'center', 'font-size': '14px',
                  }}>⬆</div>
                  <div>
                    <div style={{ 'font-size': '13px', 'font-weight': '600' }}>
                      Uploading: {currentUploadFile() || 'Preparing...'}
                    </div>
                    <div style={{ 'font-size': '12px', color: 'var(--text-muted)' }}>
                      {formatBytes(uploadedBytes())} / {formatBytes(totalUploadBytes())}
                    </div>
                  </div>
                </div>
                <div style={{ 'text-align': 'right' }}>
                  <div style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--primary)' }}>{uploadProgress()}%</div>
                  <div style={{ 'font-size': '12px', color: 'var(--text-muted)' }}>
                    ⚡ {formatSpeed(uploadSpeed())} {uploadETA() && `· ${uploadETA()} left`}
                  </div>
                </div>
              </div>
              <div class="fm-progress">
                <div class="fm-progress-bar" style={{ width: `${uploadProgress()}%` }}></div>
              </div>
            </div>
          </Show>

          {/* Breadcrumb + Toolbar */}
          <div style={{
            background: 'var(--surface)',
            'border-bottom': '1px solid var(--border)',
            padding: '0 20px',
          }}>
            {/* Breadcrumb */}
            <Show when={!searchQuery()}>
              <div style={{ display: 'flex', 'align-items': 'center', 'min-height': '40px', gap: '4px', 'flex-wrap': 'wrap' }}>
                <For each={folderPath()}>
                  {(item, index) => (
                    <>
                      <button
                        class="fm-btn-ghost fm-btn-sm"
                        style={{
                          color: index() === folderPath().length - 1 ? 'var(--text)' : 'var(--text-muted)',
                          'font-weight': index() === folderPath().length - 1 ? '600' : '400',
                          padding: '4px 6px',
                        }}
                        onClick={() => navigateToFolder(item.id)}
                      >
                        {index() === 0 && <span style={{ 'margin-right': '4px' }}>🏠</span>}
                        {item.name}
                      </button>
                      {index() < folderPath().length - 1 && (
                        <span style={{ color: 'var(--text-muted)', 'font-size': '12px' }}>›</span>
                      )}
                    </>
                  )}
                </For>
              </div>
            </Show>
            <Show when={!!searchQuery()}>
              <div style={{ display: 'flex', 'align-items': 'center', 'min-height': '40px', color: 'var(--text-muted)', 'font-size': '13px' }}>
                🔍 Search results for "{searchQuery()}"
              </div>
            </Show>

            {/* Toolbar */}
            <div style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              'padding-bottom': '10px',
              'flex-wrap': 'wrap',
            }}>
              <Show when={!searchQuery()}>
                <button class="fm-btn" onClick={() => setShowCreateFolder(true)}>
                  📁+ New Folder
                </button>
                <button class="fm-btn" onClick={triggerUpload} disabled={uploading()}>
                  ⬆ Upload Files
                </button>
              </Show>

              <Show when={selectedFiles().size > 0}>
                <div style={{ height: '20px', width: '1px', background: 'var(--border)' }}></div>
                <button class="fm-btn fm-btn-danger fm-btn-sm" onClick={deleteSelected}>
                  🗑️ Delete ({selectedFiles().size})
                </button>
              </Show>

              <div style={{ 'margin-left': 'auto', display: 'flex', gap: '8px', 'align-items': 'center' }}>
                <select
                  class="fm-select"
                  value={filterType()}
                  onChange={(e) => { setFilterType(e.currentTarget.value); loadData(currentFolderId()); }}
                >
                  <option value="all">All Types</option>
                  <option value="image">🖼️ Images</option>
                  <option value="video">🎬 Videos</option>
                  <option value="audio">🎵 Audio</option>
                  <option value="application/pdf">📕 PDFs</option>
                  <option value="application">📄 Documents</option>
                </select>
                <select
                  class="fm-select"
                  value={`${sortBy()}-${sortDir()}`}
                  onChange={(e) => {
                    const [by, dir] = e.currentTarget.value.split('-');
                    setSortBy(by as any);
                    setSortDir(dir as any);
                  }}
                >
                  <option value="date-desc">📅 Newest First</option>
                  <option value="date-asc">📅 Oldest First</option>
                  <option value="name-asc">🔤 Name A-Z</option>
                  <option value="name-desc">🔤 Name Z-A</option>
                  <option value="size-desc">📏 Largest First</option>
                  <option value="size-asc">📏 Smallest First</option>
                </select>
                <div style={{ display: 'flex', border: '1px solid var(--border)', 'border-radius': 'var(--radius-sm)', overflow: 'hidden' }}>
                  <button
                    class="fm-btn-icon"
                    style={{
                      background: viewMode() === 'list' ? 'var(--primary-light)' : 'transparent',
                      color: viewMode() === 'list' ? 'var(--primary)' : 'var(--text-muted)',
                      'border-radius': 0,
                    }}
                    onClick={() => setViewMode('list')}
                    title="List view"
                  >☰</button>
                  <button
                    class="fm-btn-icon"
                    style={{
                      background: viewMode() === 'grid' ? 'var(--primary-light)' : 'transparent',
                      color: viewMode() === 'grid' ? 'var(--primary)' : 'var(--text-muted)',
                      'border-radius': 0,
                    }}
                    onClick={() => setViewMode('grid')}
                    title="Grid view"
                  >⊞</button>
                </div>
              </div>
            </div>
          </div>

          {/* ===== FILE LIST ===== */}
          <div
            style={{ flex: 1, overflow: 'auto', padding: viewMode() === 'grid' ? '20px' : '0' }}
            onContextMenu={(e) => handleContextMenu(e, 'empty')}
          >
            <Show when={loading()}>
              <div style={{ padding: '40px', 'text-align': 'center', color: 'var(--text-muted)' }}>
                <div class="fm-skeleton" style={{ width: '200px', height: '20px', margin: '0 auto 12px' }}></div>
                <div class="fm-skeleton" style={{ width: '300px', height: '16px', margin: '0 auto' }}></div>
              </div>
            </Show>

            <Show when={!loading()}>
              {/* Create Folder Inline */}
              <Show when={showCreateFolder()}>
                <div style={{
                  padding: '12px 20px',
                  background: 'var(--primary-light)',
                  display: 'flex',
                  'align-items': 'center',
                  gap: '10px',
                  'border-bottom': '1px solid var(--border)',
                }}>
                  <span style={{ 'font-size': '20px' }}>📁</span>
                  <input
                    class="fm-input"
                    type="text"
                    placeholder="Folder name..."
                    value={newFolderName()}
                    onInput={(e) => setNewFolderName(e.currentTarget.value)}
                    onKeyPress={(e) => { if (e.key === 'Enter') createFolder(); }}
                    style={{ 'max-width': '300px' }}
                    autofocus
                  />
                  <button class="fm-btn fm-btn-primary fm-btn-sm" onClick={createFolder}>Create</button>
                  <button class="fm-btn fm-btn-sm" onClick={() => { setShowCreateFolder(false); setNewFolderName(''); }}>Cancel</button>
                </div>
              </Show>

              {/* LIST VIEW */}
              <Show when={viewMode() === 'list'}>
                {/* Table Header */}
                <div style={{
                  display: 'flex',
                  'align-items': 'center',
                  padding: '8px 16px',
                  gap: '12px',
                  'font-size': '12px',
                  'font-weight': '600',
                  color: 'var(--text-muted)',
                  'text-transform': 'uppercase',
                  'letter-spacing': '0.3px',
                  'border-bottom': '1px solid var(--border)',
                  background: 'var(--surface)',
                  position: 'sticky',
                  top: 0,
                  'z-index': 5,
                }}>
                  <div
                    class="fm-checkbox"
                    classList={{ checked: selectedFiles().size > 0 && selectedFiles().size === files().length }}
                    onClick={selectAllFiles}
                    style={{ 'margin-right': '4px' }}
                  >
                    {selectedFiles().size > 0 && selectedFiles().size === files().length && (
                      <span style={{ color: 'white', 'font-size': '10px' }}>✓</span>
                    )}
                  </div>
                  <div style={{ width: '32px' }}></div>
                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => { setSortBy('name'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                    Name {sortBy() === 'name' && (sortDir() === 'asc' ? '↑' : '↓')}
                  </div>
                  <div style={{ width: '100px', cursor: 'pointer' }} onClick={() => { setSortBy('size'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                    Size {sortBy() === 'size' && (sortDir() === 'asc' ? '↑' : '↓')}
                  </div>
                  <div style={{ width: '120px', cursor: 'pointer' }} onClick={() => { setSortBy('date'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                    Modified {sortBy() === 'date' && (sortDir() === 'asc' ? '↑' : '↓')}
                  </div>
                  <div style={{ width: '80px' }}>Type</div>
                  <div style={{ width: '180px' }}>Actions</div>
                </div>

                {/* Folders */}
                <Show when={!searchQuery()}>
                  <For each={folders()}>
                    {(folder) => (
                      <div
                        class="fm-folder-row"
                        onClick={() => navigateToFolder(folder.folder_id, folder.folder_name)}
                        onContextMenu={(e) => handleContextMenu(e, 'folder', folder)}
                      >
                        <div style={{ width: '16px' }}></div>
                        <div style={{ width: '32px', 'font-size': '22px' }}>📁</div>
                        <div style={{ flex: 1, 'font-weight': '500' }}>{folder.folder_name}</div>
                        <div style={{ width: '100px', color: 'var(--text-muted)', 'font-size': '12px' }}>—</div>
                        <div style={{ width: '120px', color: 'var(--text-muted)', 'font-size': '12px' }}>{formatDate(folder.created_at)}</div>
                        <div style={{ width: '80px', color: 'var(--text-muted)', 'font-size': '12px' }}>Folder</div>
                        <div class="fm-actions" style={{ width: '180px', display: 'flex', gap: '4px' }}>
                          <button class="fm-btn-icon" title="Rename" onClick={(e) => { e.stopPropagation(); setRenameDialog({ item: folder, show: true, newName: folder.folder_name, type: 'folder' }); }}>✏️</button>
                          <button class="fm-btn-icon" title="Delete" onClick={(e) => { e.stopPropagation(); deleteFolder(folder.folder_id, folder.folder_name); }}>🗑️</button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>

                {/* Files */}
                <For each={sortedFiles()}>
                  {(file) => (
                    <div
                      class={`fm-file-row ${selectedFiles().has(file.file_id) ? 'selected' : ''}`}
                      onContextMenu={(e) => handleContextMenu(e, 'file', file)}
                    >
                      <div
                        class="fm-checkbox"
                        classList={{ checked: selectedFiles().has(file.file_id) }}
                        onClick={(e) => { e.stopPropagation(); toggleFileSelection(file.file_id); }}
                        style={{ 'margin-right': '4px' }}
                      >
                        {selectedFiles().has(file.file_id) && (
                          <span style={{ color: 'white', 'font-size': '10px' }}>✓</span>
                        )}
                      </div>
                      <div style={{ width: '32px' }}>{getFileIcon(file.mime_type, 'sm')}</div>
                      <div style={{ flex: 1, 'font-weight': '500', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                        {file.file_name}
                        {file.is_public && <span class="fm-badge fm-badge-success" style={{ 'margin-left': '8px' }}>Public</span>}
                      </div>
                      <div style={{ width: '100px', 'font-size': '12px', color: 'var(--text-secondary)' }}>{formatBytes(file.file_size)}</div>
                      <div style={{ width: '120px', 'font-size': '12px', color: 'var(--text-muted)' }}>{formatDate(file.created_at)}</div>
                      <div style={{ width: '80px', 'font-size': '12px', color: 'var(--text-muted)' }}>{getMimeCategory(file.mime_type)}</div>
                      <div class="fm-actions" style={{ width: '180px', display: 'flex', gap: '2px' }}>
                        <button class="fm-btn-icon" title="Copy Link" onClick={(e) => { e.stopPropagation(); copyDirectLink(file); }}>🔗</button>
                        <a href={api.getStreamUrl(file.file_id)} target="_blank" class="fm-btn-icon" title="View" onClick={(e) => e.stopPropagation()}>👁️</a>
                        <a href={api.getDownloadUrl(file.file_id)} class="fm-btn-icon" title="Download" onClick={(e) => e.stopPropagation()}>⬇️</a>
                        <button class="fm-btn-icon" title="Share" onClick={(e) => { e.stopPropagation(); openShareDialog(file); }}>📤</button>
                        <button class="fm-btn-icon" title="More" onClick={(e) => { e.stopPropagation(); handleContextMenu(e as any, 'file', file); }}>⋯</button>
                      </div>
                    </div>
                  )}
                </For>
              </Show>

              {/* GRID VIEW */}
              <Show when={viewMode() === 'grid'}>
                {/* Folders Grid */}
                <Show when={!searchQuery() && folders().length > 0}>
                  <div style={{ 'margin-bottom': '24px' }}>
                    <div style={{ 'font-size': '12px', 'font-weight': '600', color: 'var(--text-muted)', 'text-transform': 'uppercase', 'letter-spacing': '0.3px', 'margin-bottom': '12px' }}>
                      Folders ({folders().length})
                    </div>
                    <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                      <For each={folders()}>
                        {(folder) => (
                          <div
                            class="fm-folder-card"
                            onClick={() => navigateToFolder(folder.folder_id, folder.folder_name)}
                            onContextMenu={(e) => handleContextMenu(e, 'folder', folder)}
                          >
                            <span style={{ 'font-size': '28px' }}>📁</span>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{ 'font-weight': '600', 'font-size': '13px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                                {folder.folder_name}
                              </div>
                              <div style={{ 'font-size': '11px', color: 'var(--text-muted)' }}>
                                {formatDate(folder.created_at)}
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* Files Grid */}
                <Show when={sortedFiles().length > 0}>
                  <div style={{ 'font-size': '12px', 'font-weight': '600', color: 'var(--text-muted)', 'text-transform': 'uppercase', 'letter-spacing': '0.3px', 'margin-bottom': '12px' }}>
                    Files ({sortedFiles().length})
                  </div>
                  <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                    <For each={sortedFiles()}>
                      {(file) => (
                        <div
                          class={`fm-file-card ${selectedFiles().has(file.file_id) ? 'selected' : ''}`}
                          onClick={() => toggleFileSelection(file.file_id)}
                          onContextMenu={(e) => handleContextMenu(e, 'file', file)}
                        >
                          <div class="fm-card-actions">
                            <button class="fm-btn-icon" title="Copy Link" onClick={(e) => { e.stopPropagation(); copyDirectLink(file); }} style={{ background: 'var(--surface)', 'box-shadow': 'var(--shadow-sm)' }}>🔗</button>
                          </div>
                          <div style={{ 'text-align': 'center', 'margin-bottom': '12px', padding: '16px 0' }}>
                            {getFileIcon(file.mime_type, 'lg')}
                          </div>
                          <div style={{ 'font-weight': '600', 'font-size': '13px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'margin-bottom': '4px' }}>
                            {file.file_name}
                          </div>
                          <div style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '11px', color: 'var(--text-muted)' }}>
                            <span>{formatBytes(file.file_size)}</span>
                            <span>{formatDate(file.created_at)}</span>
                          </div>
                          {file.is_public && <span class="fm-badge fm-badge-success" style={{ 'margin-top': '6px' }}>Public</span>}
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>

              {/* Empty State */}
              <Show when={!loading() && sortedFiles().length === 0 && folders().length === 0}>
                <div class="fm-empty">
                  <div class="fm-empty-icon">{searchQuery() ? '🔍' : '📂'}</div>
                  <div class="fm-empty-title">
                    {searchQuery() ? 'No results found' : 'This folder is empty'}
                  </div>
                  <div class="fm-empty-desc">
                    {searchQuery()
                      ? `No files match "${searchQuery()}". Try a different search term.`
                      : 'Drop files here or click "Upload Files" to get started. You can also create folders to organize your files.'
                    }
                  </div>
                  <Show when={!searchQuery()}>
                    <div style={{ display: 'flex', gap: '10px', 'margin-top': '20px' }}>
                      <button class="fm-btn fm-btn-primary" onClick={triggerUpload}>⬆ Upload Files</button>
                      <button class="fm-btn" onClick={() => setShowCreateFolder(true)}>📁+ New Folder</button>
                    </div>
                  </Show>
                </div>
              </Show>
            </Show>
          </div>

          {/* ===== STATUS BAR ===== */}
          <div style={{
            height: '32px',
            background: 'var(--surface)',
            'border-top': '1px solid var(--border)',
            display: 'flex',
            'align-items': 'center',
            padding: '0 20px',
            gap: '20px',
            'font-size': '12px',
            color: 'var(--text-muted)',
            'flex-shrink': 0,
          }}>
            <span>{folders().length} folder(s), {sortedFiles().length} file(s)</span>
            {selectedFiles().size > 0 && <span style={{ color: 'var(--primary)' }}>• {selectedFiles().size} selected</span>}
            <span style={{ 'margin-left': 'auto' }}>Total: {formatBytes(totalSize())}</span>
          </div>
        </main>
      </div>

      {/* ===== CONTEXT MENU ===== */}
      <Show when={contextMenu()}>
        <div
          class="fm-context-menu"
          style={{ left: `${contextMenu()!.x}px`, top: `${contextMenu()!.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={contextMenu()!.type === 'file'}>
            <button class="fm-context-item" onClick={() => { window.open(api.getStreamUrl(contextMenu()!.target.file_id), '_blank'); setContextMenu(null); }}>
              👁️ View / Open
            </button>
            <button class="fm-context-item" onClick={() => { const a = document.createElement('a'); a.href = api.getDownloadUrl(contextMenu()!.target.file_id); a.click(); setContextMenu(null); }}>
              ⬇️ Download
            </button>
            <button class="fm-context-item" onClick={() => { copyDirectLink(contextMenu()!.target); setContextMenu(null); }}>
              🔗 Copy Link
            </button>
            <button class="fm-context-item" onClick={() => { copyDownloadLink(contextMenu()!.target); setContextMenu(null); }}>
              📋 Copy Download Link
            </button>
            <div class="fm-context-sep"></div>
            <button class="fm-context-item" onClick={() => { openShareDialog(contextMenu()!.target); setContextMenu(null); }}>
              📤 Share
            </button>
            <button class="fm-context-item" onClick={() => { setRenameDialog({ item: contextMenu()!.target, show: true, newName: contextMenu()!.target.file_name, type: 'file' }); setContextMenu(null); }}>
              ✏️ Rename
            </button>
            <button class="fm-context-item" onClick={() => { setMoveDialog({ item: contextMenu()!.target, type: 'file', show: true }); setContextMenu(null); }}>
              📁 Move to...
            </button>
            <div class="fm-context-sep"></div>
            <button class="fm-context-item danger" onClick={() => { deleteFile(contextMenu()!.target.file_id, contextMenu()!.target.file_name); setContextMenu(null); }}>
              🗑️ Delete
            </button>
          </Show>

          <Show when={contextMenu()!.type === 'folder'}>
            <button class="fm-context-item" onClick={() => { navigateToFolder(contextMenu()!.target.folder_id, contextMenu()!.target.folder_name); setContextMenu(null); }}>
              📂 Open
            </button>
            <button class="fm-context-item" onClick={() => { setRenameDialog({ item: contextMenu()!.target, show: true, newName: contextMenu()!.target.folder_name, type: 'folder' }); setContextMenu(null); }}>
              ✏️ Rename
            </button>
            <div class="fm-context-sep"></div>
            <button class="fm-context-item danger" onClick={() => { deleteFolder(contextMenu()!.target.folder_id, contextMenu()!.target.folder_name); setContextMenu(null); }}>
              🗑️ Delete
            </button>
          </Show>

          <Show when={contextMenu()!.type === 'empty'}>
            <button class="fm-context-item" onClick={() => { setShowCreateFolder(true); setContextMenu(null); }}>
              📁+ New Folder
            </button>
            <button class="fm-context-item" onClick={() => { triggerUpload(); setContextMenu(null); }}>
              ⬆ Upload Files
            </button>
            <div class="fm-context-sep"></div>
            <button class="fm-context-item" onClick={() => { loadData(currentFolderId()); setContextMenu(null); }}>
              🔄 Refresh
            </button>
          </Show>
        </div>
      </Show>

      {/* ===== SHARE DIALOG ===== */}
      <Show when={shareDialog()}>
        <div class="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShareDialog(null); }}>
          <div class="fm-modal">
            <div class="fm-modal-header">📤 Share: {shareDialog()?.file_name}</div>
            <div class="fm-modal-body">
              <Show when={!shareResult()} fallback={
                <div>
                  <div style={{
                    padding: '14px',
                    background: 'var(--primary-light)',
                    'border-radius': 'var(--radius-sm)',
                    'word-break': 'break-all',
                    'font-size': '13px',
                    'margin-bottom': '12px',
                  }}>
                    <div style={{ 'font-weight': '600', 'margin-bottom': '4px', 'font-size': '12px', color: 'var(--text-muted)' }}>Share Link:</div>
                    {window.location.origin}/s/{shareResult()?.share_id}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button class="fm-btn fm-btn-primary" style={{ flex: 1 }} onClick={copyShareLink}>📋 Copy Link</button>
                    <button class="fm-btn" style={{ flex: 1 }} onClick={() => setShareDialog(null)}>Close</button>
                  </div>
                </div>
              }>
                <div style={{ 'margin-bottom': '14px' }}>
                  <label style={{ display: 'block', 'margin-bottom': '4px', 'font-size': '13px', 'font-weight': '500' }}>Password (optional)</label>
                  <input
                    class="fm-input"
                    type="password"
                    placeholder="Leave empty for no password"
                    value={sharePassword()}
                    onInput={(e) => setSharePassword(e.currentTarget.value)}
                  />
                </div>
                <div style={{ 'margin-bottom': '16px' }}>
                  <label style={{ display: 'block', 'margin-bottom': '4px', 'font-size': '13px', 'font-weight': '500' }}>Expiry Date (optional)</label>
                  <input
                    class="fm-input"
                    type="datetime-local"
                    value={shareExpiry()}
                    onInput={(e) => setShareExpiry(e.currentTarget.value)}
                  />
                </div>
              </Show>
            </div>
            <Show when={!shareResult()}>
              <div class="fm-modal-footer">
                <button class="fm-btn" onClick={() => setShareDialog(null)}>Cancel</button>
                <button class="fm-btn fm-btn-primary" onClick={createShareLink}>Generate Link</button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* ===== RENAME DIALOG ===== */}
      <Show when={renameDialog().show}>
        <div class="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setRenameDialog({ item: null, show: false, newName: '', type: 'file' }); }}>
          <div class="fm-modal">
            <div class="fm-modal-header">✏️ Rename {renameDialog().type === 'folder' ? 'Folder' : 'File'}</div>
            <div class="fm-modal-body">
              <input
                class="fm-input"
                type="text"
                value={renameDialog().newName}
                onInput={(e) => setRenameDialog({ ...renameDialog(), newName: e.currentTarget.value })}
                onKeyPress={(e) => { if (e.key === 'Enter') renameItem(); }}
                autofocus
              />
            </div>
            <div class="fm-modal-footer">
              <button class="fm-btn" onClick={() => setRenameDialog({ item: null, show: false, newName: '', type: 'file' })}>Cancel</button>
              <button class="fm-btn fm-btn-primary" onClick={renameItem}>Rename</button>
            </div>
          </div>
        </div>
      </Show>

      {/* ===== MOVE DIALOG ===== */}
      <Show when={moveDialog().show}>
        <div class="fm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setMoveDialog({ item: null, type: 'file', show: false }); }}>
          <div class="fm-modal">
            <div class="fm-modal-header">📁 Move: {moveDialog().item?.file_name}</div>
            <div class="fm-modal-body" style={{ 'max-height': '400px', overflow: 'auto' }}>
              <button
                class="fm-btn"
                style={{ width: '100%', 'justify-content': 'flex-start', 'margin-bottom': '6px' }}
                onClick={() => moveFileToFolder(null)}
              >
                🏠 Root (My Drive)
              </button>
              <For each={flattenTree(folderTree())}>
                {(folder) => (
                  <button
                    class="fm-btn"
                    style={{
                      width: '100%',
                      'justify-content': 'flex-start',
                      'margin-bottom': '4px',
                      'padding-left': `${12 + (folder.level || 0) * 20}px`,
                    }}
                    onClick={() => moveFileToFolder(folder.folder_id)}
                  >
                    📁 {folder.folder_name}
                  </button>
                )}
              </For>
            </div>
            <div class="fm-modal-footer">
              <button class="fm-btn" onClick={() => setMoveDialog({ item: null, type: 'file', show: false })}>Cancel</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
