import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import 'services/api_service.dart';
import 'services/auth_service.dart';
import 'services/backup_service.dart';
import 'pages/login_page.dart';
import 'pages/dashboard_page.dart';
import 'pages/files_page.dart';
import 'pages/community_page.dart';
import 'pages/settings_page.dart';
import 'pages/backup_settings_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const InfiniDriveApp());
}

class InfiniDriveApp extends StatelessWidget {
  const InfiniDriveApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ApiService()),
        ChangeNotifierProvider(
          create: (context) => AuthService(
            Provider.of<ApiService>(context, listen: false),
          ),
        ),
        ChangeNotifierProvider(
          create: (context) => BackupService(
            Provider.of<ApiService>(context, listen: false),
          ),
        ),
      ],
      child: MaterialApp.router(
        title: 'InfiniDrive',
        theme: ThemeData(
          primarySwatch: Colors.blue,
          useMaterial3: true,
        ),
        routerConfig: _router,
      ),
    );
  }
}

final GoRouter _router = GoRouter(
  initialLocation: '/login',
  routes: [
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginPage(),
    ),
    GoRoute(
      path: '/dashboard',
      builder: (context, state) => const DashboardPage(),
    ),
    GoRoute(
      path: '/files',
      builder: (context, state) => const FilesPage(),
    ),
    GoRoute(
      path: '/community',
      builder: (context, state) => const CommunityPage(),
    ),
    GoRoute(
      path: '/settings',
      builder: (context, state) => const SettingsPage(),
    ),
    GoRoute(
      path: '/backup-settings',
      builder: (context, state) => const BackupSettingsPage(),
    ),
  ],
);
