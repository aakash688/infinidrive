import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/backup_service.dart';
import '../services/api_service.dart';

class BackupSettingsPage extends StatefulWidget {
  const BackupSettingsPage({super.key});

  @override
  State<BackupSettingsPage> createState() => _BackupSettingsPageState();
}

class _BackupSettingsPageState extends State<BackupSettingsPage> {
  final List<String> _selectedFolders = [];
  bool _wifiOnly = true;
  String _frequency = 'daily';

  @override
  Widget build(BuildContext context) {
    final backup = Provider.of<BackupService>(context);
    final api = Provider.of<ApiService>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Backup Settings'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Select Folders to Backup',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          _FolderOption(
            title: 'Camera',
            path: '/DCIM/Camera',
            selected: _selectedFolders.contains('/DCIM/Camera'),
            onTap: () {
              setState(() {
                if (_selectedFolders.contains('/DCIM/Camera')) {
                  _selectedFolders.remove('/DCIM/Camera');
                } else {
                  _selectedFolders.add('/DCIM/Camera');
                }
              });
            },
          ),
          _FolderOption(
            title: 'Downloads',
            path: '/Download',
            selected: _selectedFolders.contains('/Download'),
            onTap: () {
              setState(() {
                if (_selectedFolders.contains('/Download')) {
                  _selectedFolders.remove('/Download');
                } else {
                  _selectedFolders.add('/Download');
                }
              });
            },
          ),
          const SizedBox(height: 24),
          SwitchListTile(
            title: const Text('Wi-Fi Only'),
            value: _wifiOnly,
            onChanged: (value) {
              setState(() {
                _wifiOnly = value;
              });
            },
          ),
          const SizedBox(height: 16),
          const Text('Backup Frequency'),
          DropdownButton<String>(
            value: _frequency,
            items: const [
              DropdownMenuItem(value: 'realtime', child: Text('Realtime')),
              DropdownMenuItem(value: 'hourly', child: Text('Hourly')),
              DropdownMenuItem(value: 'daily', child: Text('Daily')),
            ],
            onChanged: (value) {
              if (value != null) {
                setState(() {
                  _frequency = value;
                });
              }
            },
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () async {
              // Get device ID
              final devices = await api.listDevices();
              if (devices.isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('No device registered')),
                );
                return;
              }
              
              final deviceId = devices.first['device_id'];
              await backup.startBackup(deviceId, _selectedFolders);
              
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Backup started')),
                );
              }
            },
            child: const Text('Start Backup'),
          ),
        ],
      ),
    );
  }
}

class _FolderOption extends StatelessWidget {
  final String title;
  final String path;
  final bool selected;
  final VoidCallback onTap;

  const _FolderOption({
    required this.title,
    required this.path,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return CheckboxListTile(
      title: Text(title),
      subtitle: Text(path),
      value: selected,
      onChanged: (_) => onTap(),
    );
  }
}
