import 'package:flutter/foundation.dart';
import 'package:workmanager/workmanager.dart';
import 'package:permission_handler/permission_handler.dart';
import 'dart:io';
import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'api_service.dart';

class BackupService extends ChangeNotifier {
  final ApiService _api;
  bool _isBackingUp = false;
  double _backupProgress = 0.0;

  BackupService(this._api);

  bool get isBackingUp => _isBackingUp;
  double get backupProgress => _backupProgress;

  Future<void> initialize() async {
    await Workmanager().initialize(callbackDispatcher, isInDebugMode: true);
  }

  Future<void> startBackup(String deviceId, List<String> folderPaths) async {
    // Request permissions
    final status = await Permission.storage.request();
    if (!status.isGranted) {
      throw Exception('Storage permission denied');
    }

    // Register periodic task
    await Workmanager().registerPeriodicTask(
      'backup_task',
      'backupFiles',
      frequency: const Duration(hours: 1),
      constraints: Constraints(
        networkType: NetworkType.connected,
        requiresBatteryNotLow: false,
        requiresCharging: false,
        requiresDeviceIdle: false,
        requiresStorageNotLow: false,
      ),
    );

    // Save backup config
    for (final folderPath in folderPaths) {
      await _api.saveBackupConfig({
        'device_id': deviceId,
        'folder_path': folderPath,
        'is_active': true,
        'wifi_only': true,
        'frequency': 'hourly',
        'file_types': 'all',
      });
    }
  }

  Future<void> performBackup(String deviceId) async {
    _isBackingUp = true;
    _backupProgress = 0.0;
    notifyListeners();

    try {
      // Get backup configs
      final configs = await _api.getBackupConfig(deviceId);
      
      for (final config in configs) {
        if (!config['is_active']) continue;
        
        final folderPath = config['folder_path'];
        final directory = Directory(folderPath);
        
        if (!await directory.exists()) continue;

        // Scan folder for files
        final files = await _scanFolder(directory);
        final fileHashes = files.map((f) => f['hash'] as String).toList();

        // Check which files need backup
        final checkResult = await _api.checkBackup(deviceId, fileHashes);
        final missingHashes = List<String>.from(checkResult['missing_hashes'] ?? []);

        // Upload missing files
        final missingFiles = files.where((f) => missingHashes.contains(f['hash'])).toList();
        final total = missingFiles.length;
        
        for (int i = 0; i < missingFiles.length; i++) {
          final file = missingFiles[i];
          await _uploadFile(deviceId, file['path'] as String, file['hash'] as String);
          _backupProgress = (i + 1) / total;
          notifyListeners();
        }
      }
    } finally {
      _isBackingUp = false;
      _backupProgress = 0.0;
      notifyListeners();
    }
  }

  Future<List<Map<String, dynamic>>> _scanFolder(Directory directory) async {
    final files = <Map<String, dynamic>>[];
    
    await for (final entity in directory.list(recursive: true)) {
      if (entity is File) {
        final hash = await _calculateHash(entity);
        files.add({
          'path': entity.path,
          'hash': hash,
          'size': await entity.length(),
        });
      }
    }
    
    return files;
  }

  Future<String> _calculateHash(File file) async {
    final bytes = await file.readAsBytes();
    final digest = sha256.convert(bytes);
    return digest.toString();
  }

  Future<void> _uploadFile(String deviceId, String filePath, String fileHash) async {
    final file = File(filePath);
    final fileName = file.path.split('/').last;
    final fileSize = await file.length();
    final mimeType = _getMimeType(fileName);

    // Init upload
    final initResult = await _api.initUpload({
      'file_name': fileName,
      'file_size': fileSize,
      'mime_type': mimeType,
      'file_hash': fileHash,
      'device_id': deviceId,
      'file_path': filePath,
    });

    final fileId = initResult['file_id'];
    final chunkCount = initResult['chunk_count'] as int;
    const chunkSize = 20 * 1024 * 1024; // 20MB

    // Upload chunks
    final fileBytes = await file.readAsBytes();
    for (int i = 0; i < chunkCount; i++) {
      final start = i * chunkSize;
      final end = (start + chunkSize < fileBytes.length) ? start + chunkSize : fileBytes.length;
      final chunk = fileBytes.sublist(start, end);
      final chunkHash = sha256.convert(chunk).toString();
      final chunkData = base64Encode(chunk);

      await _api.uploadChunk({
        'file_id': fileId,
        'chunk_index': i,
        'chunk_data': chunkData,
        'chunk_hash': chunkHash,
      });
    }

    // Complete upload
    await _api.completeUpload(fileId);
  }

  String _getMimeType(String fileName) {
    final ext = fileName.split('.').last.toLowerCase();
    final mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'mp4': 'video/mp4',
      'pdf': 'application/pdf',
    };
    return mimeTypes[ext] ?? 'application/octet-stream';
  }
}

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    // Perform backup task
    // This runs in a background isolate
    return Future.value(true);
  });
}
