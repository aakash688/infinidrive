import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import '../services/api_service.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  Map<String, dynamic>? _stats;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final stats = await api.getStats();
      setState(() {
        _stats = stats;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _loading = false;
      });
    }
  }

  String _formatBytes(int bytes) {
    if (bytes == 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    final i = (bytes / k).toStringAsFixed(0).length - 1;
    return '${(bytes / (k * i)).toStringAsFixed(2)} ${sizes[i]}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => context.go('/settings'),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadStats,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      crossAxisSpacing: 16,
                      mainAxisSpacing: 16,
                      children: [
                        _StatCard(
                          title: 'Total Files',
                          value: '${_stats?['total_files'] ?? 0}',
                          icon: Icons.insert_drive_file,
                        ),
                        _StatCard(
                          title: 'Total Storage',
                          value: _formatBytes(_stats?['total_size'] ?? 0),
                          icon: Icons.storage,
                        ),
                        _StatCard(
                          title: 'Devices',
                          value: '${_stats?['total_devices'] ?? 0}',
                          icon: Icons.devices,
                        ),
                        _StatCard(
                          title: 'Active Bots',
                          value: '${_stats?['total_bots'] ?? 0}',
                          icon: Icons.smart_toy,
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      'Recent Files',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (_stats?['recent_files'] != null)
                      ...(_stats!['recent_files'] as List)
                          .map((file) => _FileTile(file: file))
                          .toList(),
                  ],
                ),
              ),
            ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: 0,
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.dashboard),
            label: 'Dashboard',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.folder),
            label: 'Files',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.people),
            label: 'Community',
          ),
        ],
        onTap: (index) {
          if (index == 1) context.go('/files');
          if (index == 2) context.go('/community');
        },
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;

  const _StatCard({
    required this.title,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 32, color: Colors.blue),
            const SizedBox(height: 8),
            Text(
              value,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              title,
              style: const TextStyle(
                fontSize: 12,
                color: Colors.grey,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FileTile extends StatelessWidget {
  final Map<String, dynamic> file;

  const _FileTile({required this.file});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: const Icon(Icons.insert_drive_file),
        title: Text(file['file_name'] ?? 'Unknown'),
        subtitle: Text('${file['file_size'] ?? 0} bytes'),
        trailing: IconButton(
          icon: const Icon(Icons.open_in_new),
          onPressed: () {
            // Open file
          },
        ),
      ),
    );
  }
}
