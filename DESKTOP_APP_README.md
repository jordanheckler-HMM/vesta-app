# Vesta - Desktop App Quick Start

## 🚀 Launch Options

### Option 1: Desktop App (Recommended)
Double-click the app icon:
```bash
open /Applications/Vesta.app
```

Or build it yourself:
```bash
cd vesta-frontend
npm run tauri:build
# App created at: src-tauri/target/release/bundle/macos/Vesta.app
```

**Requirements:**
- Ollama installed and running
- That's it! (No Python, Node.js, or terminal needed)

### Option 2: Development Mode
For developers working on the code:
```bash
cd vesta-frontend
npm run tauri:dev
```

### Option 3: Browser Mode (Legacy)
Original browser-based setup still works:
```bash
# Terminal 1: Backend
cd vesta-backend
uvicorn main:app --reload --port 8090

# Terminal 2: Frontend
cd vesta-frontend
npm run dev
# Open http://localhost:8081
```

## 📦 What's New

Vesta is now a native macOS desktop application! The app:
- ✅ Launches with a double-click
- ✅ Starts the backend automatically
- ✅ No terminal required
- ✅ Closes cleanly
- ✅ Looks like a real app

## 📖 Full Documentation

- **Quick Start**: This file
- **Setup Guide**: See main README.md below
- **Tauri Details**: See TAURI_COMPLETE.md
- **Implementation**: See TAURI_IMPLEMENTATION.md

---

