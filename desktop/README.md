# InfiniDrive Desktop App

Flutter Windows desktop application for InfiniDrive.

## Setup

1. Install Flutter: https://flutter.dev/docs/get-started/install

2. Create Flutter desktop project:
```bash
flutter create --platforms windows --org com.infinidrive desktop
cd desktop
```

3. Add dependencies to `pubspec.yaml`:
```yaml
dependencies:
  dio: ^5.4.0
  flutter_secure_storage: ^9.0.0
  file_picker: ^6.1.0
  tray_manager: ^0.2.0
  window_manager: ^0.3.0
```

4. Run:
```bash
flutter pub get
flutter run -d windows
```

## Features

- QR code login
- File browser
- System tray icon
- Sync folder (auto-upload)
- Drag & drop upload
- Download manager
