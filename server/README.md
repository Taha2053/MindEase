# MindEase Server

FastAPI backend supporting general document processing, animated visual explanations (Manim videos), and automated visual diagrams (Napkin AI).

The server processes arbitrary educational content, documents (PDF/HTML/web), and research papers, converting key concepts into animated visual explanations or structured visual diagrams tailored to neurodivergent learner profiles.

## Running the Server

No git clone step or separate clone virtual environment is required when working within the repository workspace.

From the repository root:
```bash
npm run server
```

Alternatively, run directly with `uv`:
```bash
uv run --directory server python main.py
```
Or with uvicorn reload:
```bash
uv run --directory server uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000` (interactive OpenAPI documentation at `http://localhost:8000/docs`).

## Native System Dependencies

For full local animation rendering and voiceover synthesis:
- **Python**: 3.11–3.13 managed via [uv](https://docs.astral.sh/uv/)
- **FFmpeg**: Required for audio/video merging and frame extraction (`brew install ffmpeg` on macOS, or `sudo apt-get install ffmpeg` on Ubuntu/Debian)
- **LaTeX Distribution**: Required by Manim for rendering math formulas and equations (e.g. `brew install --cask basictex` on macOS, or `sudo apt-get install texlive-latex-base texlive-latex-extra` on Ubuntu/Debian)

## Visual Formats: Napkin vs. Manim

MindEase distinguishes between two visual explanation paths:
- **Napkin AI (`/api/visuals/napkin`, `/api/visuals/napkin/jobs`)**: Generates 2D vector diagrams, mind maps, flowcharts, and structured visual infographics. Fast, interactive, and lightweight for quick visual summaries.
- **Manim Engine (`/api/process`, `/api/process/document`, `/api/render`)**: Generates programmatic mathematical and conceptual animations with synchronized audio narration (voiceover). Used for deep, multi-step conceptual explanations and animated video lessons.

## Environment & Provider Keys

Configuration is loaded from `server/.env` (and falls back to root `.env` without overriding existing variables). Copy `server/.env.example` to `server/.env` and supply the required keys:

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | Primary LLM provider for planning, adaptation, and generation (`deepseek-reasoner`). |
| `OPENAI_API_KEY` | Direct OpenAI provider fallback or alternative rendering role provider. |
| `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` | Azure OpenAI provider for rendering, evaluation, or visual QA. |
| `NVIDIA_API_KEY` / `VITE_NVD_API_KEY` | NVIDIA NIM provider fallback (Kimi-k3). |
| `NAPKIN_API_KEY` / `VITE_NAPKIN_API_KEY` | Napkin AI key for generating vector diagrams and mind maps. |
| `VOICEOVER_TTS_SERVICE` | `openai` (Azure OpenAI or OpenAI TTS) or `gtts` (free fallback). |
| `DATABASE_URL` | Postgres in production; unset defaults to local SQLite (`./arxiviz.db`), zero setup. |
| `STORAGE_MODE` | `local` (default, videos in `./media/videos/`) or `r2` (Cloudflare R2, requires `S3_*` vars). |
| `TAVILY_API_KEY` | Optional: Web search for related learning resources (`/api/resources/related`). |

## API Surface

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/process/document` | Ingest and process general documents (PDF / web text) into animated lessons |
| POST | `/api/process` | Ingest and process papers by ID into animated lessons |
| GET | `/api/status/{job_id}` | Poll processing job status and progress |
| GET | `/api/paper/{arxiv_id}` | Retrieve processed document/paper with sections and video URLs |
| GET | `/api/papers` | List processed items |
| GET | `/api/video/{video_id}` | Stream or redirect to rendered video asset |
| POST | `/api/visuals/napkin` | Generate structured vector diagrams via Napkin AI |
| POST | `/api/visuals/napkin/jobs` | Start async Napkin diagram generation job |
| GET | `/api/visuals/napkin/jobs/{job_id}` | Poll Napkin diagram job status |
| POST | `/api/plan/adaptation` | Create learning adaptation plan for source content |
| POST | `/api/source/extract` | Extract clean text from source URLs or documents |
| POST | `/api/resources/related` | Retrieve related external educational resources |
| POST | `/api/llm/generate` | Server-side secure LLM proxy for client adaptations |
| POST | `/api/speech` | Synthesize speech audio narration |
| POST | `/api/render` | Dev-only raw Manim scene rendering |
| GET | `/api/health` | Health check for DB, Manim rendering, and storage |
