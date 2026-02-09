# InfiniDrive Android TV App

Flutter Android TV application for InfiniDrive.

## Setup

1. Install Flutter: https://flutter.dev/docs/get-started/install

2. Create Flutter project:
```bash
flutter create --platforms android --org com.infinidrive tv
cd tv
```

3. Add dependencies to `pubspec.yaml`:
```yaml
dependencies:
  dio: ^5.4.0
  flutter_secure_storage: ^9.0.0
  video_player: ^2.8.0
```

4. Run:
```bash
flutter pub get
flutter run -d android-tv
```

## Features

- QR code login
- D-pad navigation
- Video player (full-screen)
- Photo slideshow
- Browse-only (no uploads)
