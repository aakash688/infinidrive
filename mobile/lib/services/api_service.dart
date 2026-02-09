import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/foundation.dart';

class ApiService extends ChangeNotifier {
  final Dio _dio = Dio();
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  static const String _apiBase = 'http://localhost:8787'; // Set via config
  
  String? _token;

  ApiService() {
    _loadToken();
    _dio.options.baseUrl = _apiBase;
    _dio.options.headers['Content-Type'] = 'application/json';
  }

  Future<void> _loadToken() async {
    _token = await _storage.read(key: 'auth_token');
    if (_token != null) {
      _dio.options.headers['Authorization'] = 'Bearer $_token';
    }
  }

  Future<void> setToken(String? token) async {
    _token = token;
    if (token != null) {
      await _storage.write(key: 'auth_token', value: token);
      _dio.options.headers['Authorization'] = 'Bearer $token';
    } else {
      await _storage.delete(key: 'auth_token');
      _dio.options.headers.remove('Authorization');
    }
    notifyListeners();
  }

  // Auth
  Future<Map<String, dynamic>> telegramLogin(Map<String, dynamic> data) async {
    final response = await _dio.post('/api/auth/telegram', data: data);
    return response.data;
  }

  Future<Map<String, dynamic>> generateQR() async {
    final response = await _dio.post('/api/auth/qr/generate');
    return response.data;
  }

  Future<Map<String, dynamic>> approveQR(String sessionId) async {
    final response = await _dio.post('/api/auth/qr/approve', data: {'session_id': sessionId});
    return response.data;
  }

  Future<Map<String, dynamic>> checkQRStatus(String sessionId) async {
    final response = await _dio.get('/api/auth/qr/status/$sessionId');
    return response.data;
  }

  Future<void> logout() async {
    try {
      await _dio.post('/api/auth/logout');
    } catch (e) {
      // Ignore errors
    }
    await setToken(null);
  }

  // Bots
  Future<Map<String, dynamic>> addBot(String botToken) async {
    final response = await _dio.post('/api/bots/add', data: {'bot_token': botToken});
    return response.data;
  }

  Future<List<dynamic>> listBots() async {
    final response = await _dio.get('/api/bots/list');
    return response.data['bots'];
  }

  Future<void> removeBot(String botId) async {
    await _dio.delete('/api/bots/$botId');
  }

  // Devices
  Future<List<dynamic>> listDevices() async {
    final response = await _dio.get('/api/devices/list');
    return response.data['devices'];
  }

  Future<void> registerDevice(Map<String, dynamic> device) async {
    await _dio.post('/api/devices/register', data: device);
  }

  // Files
  Future<Map<String, dynamic>> initUpload(Map<String, dynamic> fileData) async {
    final response = await _dio.post('/api/files/upload/init', data: fileData);
    return response.data;
  }

  Future<Map<String, dynamic>> uploadChunk(Map<String, dynamic> chunkData) async {
    final response = await _dio.post('/api/files/upload/chunk', data: chunkData);
    return response.data;
  }

  Future<void> completeUpload(String fileId) async {
    await _dio.post('/api/files/upload/complete', data: {'file_id': fileId});
  }

  Future<List<dynamic>> listFiles({Map<String, dynamic>? params}) async {
    final response = await _dio.get('/api/files/list', queryParameters: params);
    return response.data['files'];
  }

  Future<Map<String, dynamic>> getFile(String fileId) async {
    final response = await _dio.get('/api/files/$fileId');
    return response.data;
  }

  Future<void> deleteFile(String fileId) async {
    await _dio.delete('/api/files/$fileId');
  }

  String getStreamUrl(String fileId) => '$_apiBase/api/files/$fileId/stream';
  String getDownloadUrl(String fileId) => '$_apiBase/api/files/$fileId/download';

  // Share
  Future<Map<String, dynamic>> createShare(String fileId, {Map<String, dynamic>? options}) async {
    final response = await _dio.post('/api/share/create', data: {'file_id': fileId, ...?options});
    return response.data;
  }

  // Community
  Future<List<dynamic>> listCommunityFiles({Map<String, dynamic>? params}) async {
    final response = await _dio.get('/api/community/files', queryParameters: params);
    return response.data['files'];
  }

  Future<void> forkFile(String fileId) async {
    await _dio.post('/api/community/$fileId/fork');
  }

  // Stats
  Future<Map<String, dynamic>> getStats() async {
    final response = await _dio.get('/api/stats');
    return response.data;
  }

  // Backup
  Future<void> saveBackupConfig(Map<String, dynamic> config) async {
    await _dio.post('/api/backup/config', data: config);
  }

  Future<List<dynamic>> getBackupConfig(String deviceId) async {
    final response = await _dio.get('/api/backup/config/$deviceId');
    return response.data['configs'];
  }

  Future<Map<String, dynamic>> checkBackup(String deviceId, List<String> fileHashes) async {
    final response = await _dio.post('/api/backup/check', data: {
      'device_id': deviceId,
      'file_hashes': fileHashes,
    });
    return response.data;
  }
}
