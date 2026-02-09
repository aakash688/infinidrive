import 'package:flutter/foundation.dart';
import 'api_service.dart';

class AuthService extends ChangeNotifier {
  final ApiService _api;
  bool _isAuthenticated = false;
  Map<String, dynamic>? _user;

  AuthService(this._api) {
    _checkAuth();
  }

  bool get isAuthenticated => _isAuthenticated;
  Map<String, dynamic>? get user => _user;

  Future<void> _checkAuth() async {
    // Check if token exists - ApiService manages token internally
    // We'll check by trying to get stats (lightweight call)
    try {
      await _api.getStats();
      _isAuthenticated = true;
    } catch (e) {
      _isAuthenticated = false;
    }
    notifyListeners();
  }

  Future<bool> loginWithTelegram(Map<String, dynamic> telegramData) async {
    try {
      final response = await _api.telegramLogin(telegramData);
      await _api.setToken(response['token']);
      _user = response['user'];
      _isAuthenticated = true;
      notifyListeners();
      return true;
    } catch (e) {
      return false;
    }
  }

  Future<void> logout() async {
    try {
      await _api.logout();
    } catch (e) {
      // Ignore errors
    }
    await _api.setToken(null);
    _user = null;
    _isAuthenticated = false;
    notifyListeners();
  }
}
