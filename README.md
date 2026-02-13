 HEAD
# Vesta

**Internal AI assistant for thoughtful work**

Vesta is a local-only tool designed to support thinking through problems, drafting text, and exploring ideas. It runs entirely on your machine with no external connections, accounts, or data storage.

## What Vesta Is

- A thinking aid for drafting, problem-solving, and clarifying concepts
- Stateless: no conversation history or memory between sessions
- Local-only: no cloud services, no external API calls
- Internal use: designed for internal exploration and iteration

## What Vesta Is NOT

- Not for legal, medical, or financial advice
- Not for customer-facing communications or automated decisions
- Not a replacement for human judgment or formal review processes
- Not a data storage or memory system

## Prerequisites

- **Python 3.10+** with pip
- **Node.js 18+** with npm
- **Ollama** installed and running locally

### Install Ollama

If you don't have Ollama installed:

```bash
# macOS/Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Or download from https://ollama.ai
```

## Setup

### 1. Pull the Vesta Model

Ensure the `hymetalab/vesta-general` model is available in Ollama:

```bash
ollama pull hymetalab/vesta-general
```

Verify the model exists:

```bash
ollama list | grep hymetalab/vesta-general
```

### 2. Backend Setup

```bash
cd vesta-backend
pip install -r requirements.txt
```

### 3. Frontend Setup

```bash
cd vesta-frontend
npm install
```

## Running Vesta

You need to run both the backend and frontend in separate terminal windows.

### Start Ollama (if not already running)

```bash
ollama serve
```

### Start Backend

```bash
cd vesta-backend
uvicorn main:app --reload --port 8090
```

Expected output: `Uvicorn running on http://127.0.0.1:8090`

### Start Frontend

```bash
cd vesta-frontend
npm run dev
```

Expected output: `Local: http://localhost:8081/`

### Access Vesta

Open your browser to: **http://localhost:8081**

## Verify System Health

Check that all components are running:

```bash
# Check backend
curl http://localhost:8090/health

# Check Ollama
curl http://localhost:11434/api/version

# Check model
ollama list | grep hymetalab/vesta-general
```

Expected health response:
```json
{
  "status": "ok",
  "backend": "running",
  "ollama": "connected"
}
```

## Troubleshooting

### "Vesta cannot connect to the local AI service"

**Cause:** Ollama is not running or not reachable

**Fix:**
```bash
# Start Ollama
ollama serve

# Verify it's running
curl http://localhost:11434/api/version
```

### "Model not found" or similar errors

**Cause:** The `hymetalab/vesta-general` model is not installed

**Fix:**
```bash
ollama pull hymetalab/vesta-general
ollama list  # Verify it appears in the list
```

### Backend won't start: "Missing prompt files"

**Cause:** Required prompt files are missing from `vesta-backend/prompts/`

**Fix:** Ensure these files exist:
- `prompts/base.txt`
- `prompts/draft.txt`
- `prompts/think.txt`
- `prompts/clarify.txt`
- `prompts/general.txt`

### Port conflicts (Address already in use)

**Cause:** Another process is using port 8090 or 8081

**Fix:**
```bash
# Find and kill process on port 8090 (backend)
lsof -ti:8090 | xargs kill -9

# Find and kill process on port 8081 (frontend)
lsof -ti:8081 | xargs kill -9
```

### Frontend shows blank page or errors

**Cause:** Backend is not running or on wrong port

**Fix:**
1. Verify backend is running: `curl http://localhost:8090/health`
2. Check frontend expects `http://localhost:8090` (default)
3. Check browser console for errors

## Stopping Vesta

Press `Ctrl+C` in each terminal window (backend and frontend) to stop the services.

To stop Ollama:
```bash
# Ollama runs as a background service, typically doesn't need to be stopped
# If needed, check your system's process manager
```

## Usage Notes

- **No persistence:** Conversations are cleared when you refresh or close the page
- **Clear chat:** Use the "Clear chat" button in the top-right to start fresh
- **Session-only:** Each interaction is independent—Vesta has no memory of previous messages after you clear or refresh
- **Local network only:** Vesta is accessible only from your machine (localhost)

## Architecture

- **Frontend:** React + TypeScript + Vite (port 8081)
- **Backend:** FastAPI (port 8090)
- **Model:** Ollama `hymetalab/vesta-general` (port 11434)
- **Storage:** None—fully stateless

---

For questions or issues, contact your internal platform team.

=======
# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
 db4385a1ed2e494ae585f2ed96393d56b598f7b7
