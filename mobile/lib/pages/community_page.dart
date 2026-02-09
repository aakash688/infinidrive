import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';

class CommunityPage extends StatefulWidget {
  const CommunityPage({super.key});

  @override
  State<CommunityPage> createState() => _CommunityPageState();
}

class _CommunityPageState extends State<CommunityPage> {
  List<dynamic> _files = [];
  bool _loading = true;
  String _searchQuery = '';
  String? _selectedCategory;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadFiles();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadFiles() async {
    setState(() => _loading = true);
    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final params = <String, dynamic>{};
      if (_searchQuery.isNotEmpty) params['q'] = _searchQuery;
      if (_selectedCategory != null) params['category'] = _selectedCategory;
      final files = await api.listCommunityFiles(params: params);
      setState(() {
        _files = files;
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
    }
  }

  Future<void> _forkFile(String fileId) async {
    try {
      final api = Provider.of<ApiService>(context, listen: false);
      await api.forkFile(fileId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('File forked successfully!')),
        );
        _loadFiles();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Fork failed: ${e.toString()}')),
        );
      }
    }
  }

  String _formatBytes(int bytes) {
    if (bytes == 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    int i = 0;
    double size = bytes.toDouble();
    while (size >= k && i < sizes.length - 1) {
      size /= k;
      i++;
    }
    return '${size.toStringAsFixed(1)} ${sizes[i]}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Community'),
      ),
      body: Column(
        children: [
          // Search & filter bar
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search files...',
                      prefixIcon: const Icon(Icons.search),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    onSubmitted: (value) {
                      setState(() => _searchQuery = value);
                      _loadFiles();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                PopupMenuButton<String?>(
                  icon: const Icon(Icons.filter_list),
                  tooltip: 'Filter by category',
                  onSelected: (value) {
                    setState(() => _selectedCategory = value);
                    _loadFiles();
                  },
                  itemBuilder: (context) => [
                    const PopupMenuItem(value: null, child: Text('All')),
                    const PopupMenuItem(value: 'video', child: Text('Videos')),
                    const PopupMenuItem(value: 'image', child: Text('Images')),
                    const PopupMenuItem(value: 'document', child: Text('Documents')),
                    const PopupMenuItem(value: 'audio', child: Text('Audio')),
                    const PopupMenuItem(value: 'other', child: Text('Other')),
                  ],
                ),
              ],
            ),
          ),
          if (_selectedCategory != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Chip(
                label: Text('Category: $_selectedCategory'),
                onDeleted: () {
                  setState(() => _selectedCategory = null);
                  _loadFiles();
                },
              ),
            ),
          // File list
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _files.isEmpty
                    ? const Center(
                        child: Text(
                          'No public files found.',
                          style: TextStyle(color: Colors.grey),
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadFiles,
                        child: ListView.builder(
                          padding: const EdgeInsets.all(12),
                          itemCount: _files.length,
                          itemBuilder: (context, index) {
                            final file = _files[index];
                            return Card(
                              margin: const EdgeInsets.only(bottom: 12),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      file['public_title'] ?? file['file_name'] ?? 'Unknown',
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${_formatBytes(file['file_size'] ?? 0)} • '
                                      '${file['view_count'] ?? 0} views • '
                                      '${file['fork_count'] ?? 0} forks',
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: Colors.grey[600],
                                      ),
                                    ),
                                    if (file['owner_name'] != null)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 2),
                                        child: Text(
                                          'By ${file['owner_name']}',
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: Colors.grey[500],
                                          ),
                                        ),
                                      ),
                                    const SizedBox(height: 12),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: OutlinedButton.icon(
                                            icon: const Icon(Icons.play_arrow, size: 18),
                                            label: const Text('Stream'),
                                            onPressed: () {
                                              // Open stream URL
                                            },
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: ElevatedButton.icon(
                                            icon: const Icon(Icons.fork_right, size: 18),
                                            label: const Text('Fork'),
                                            onPressed: () => _forkFile(file['file_id']),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}
