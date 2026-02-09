import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';

class FilesPage extends StatefulWidget {
  const FilesPage({super.key});

  @override
  State<FilesPage> createState() => _FilesPageState();
}

class _FilesPageState extends State<FilesPage> {
  List<dynamic> _files = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadFiles();
  }

  Future<void> _loadFiles() async {
    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final files = await api.listFiles();
      setState(() {
        _files = files;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Files'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _files.isEmpty
              ? const Center(child: Text('No files yet'))
              : ListView.builder(
                  itemCount: _files.length,
                  itemBuilder: (context, index) {
                    final file = _files[index];
                    return ListTile(
                      leading: const Icon(Icons.insert_drive_file),
                      title: Text(file['file_name'] ?? 'Unknown'),
                      subtitle: Text('${file['file_size'] ?? 0} bytes'),
                      trailing: IconButton(
                        icon: const Icon(Icons.download),
                        onPressed: () {
                          // Download file
                        },
                      ),
                    );
                  },
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // Upload file
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}
