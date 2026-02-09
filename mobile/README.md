# InfiniDrive Mobile App

Flutter Android mobile application for InfiniDrive.

## Setup

1. Install Flutter: https://flutter.dev/docs/get-started/install

2. Create Flutter project:
```bash
flutter create --org com.infinidrive mobile
cd mobile
```

3. Add dependencies to `pubspec.yaml`:
```yaml
dependencies:
  dio: ^5.4.0
  workmanager: ^0.5.2
  flutter_secure_storage: ^9.0.0
  video_player: ^2.8.0
  share_plus: ^7.2.0
  file_picker: ^6.1.0
  path_provider: ^2.1.0
  permission_handler: ^11.0.0
```

4. Run:
```bash
flutter pub get
flutter run
```

## Features

- Telegram login via deep link
- File browser (by device, by folder)
- Upload (manual + share intent)
- Download (stream-and-write, no double storage)
- Auto backup (WorkManager background service)
- Video player (streaming)
- Community tab
