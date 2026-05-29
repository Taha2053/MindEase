from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from google import genai
import os
import json
import fitz
import tempfile
from dotenv import load_dotenv

from prompts import build_prompt
from profile_client import get_profile, send_session_event

load_dotenv()

app = FastAPI(title="Layer 1 — Content Transformation")
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# ── Health check ──────────────────────────────────────────
@app.get("/")
def root():
    return {
        "layer": 1,
        "status": "running",
        "modes": ["pdf", "web", "video", "lecture"]
    }

# ── Core streaming function ───────────────────────────────
async def stream_transform(text: str, mode: str, profile: dict):
    system_prompt = build_prompt(mode, profile)
    full_prompt = f"{system_prompt}\n\n{text}"

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=full_prompt
        )
        return JSONResponse({"text": response.text})
    except Exception as e:
        return JSONResponse({"error": f"Transformation failed. Details: {str(e)}"}, status_code=500)

# ── Route 1: Transform raw text ───────────────────────────
@app.post("/transform/text")
async def transform_text(
    text: str = Form(...),
    mode: str = Form(...),
    user_id: str = Form("guest")
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty")

    profile = await get_profile(user_id)
    await send_session_event(user_id, {"type": "session_start", "mode": mode})
    return await stream_transform(text, mode, profile)

# ── Route 2: Upload a PDF ─────────────────────────────────
@app.post("/transform/pdf")
async def transform_pdf(
    file: UploadFile = File(...),
    user_id: str = Form("guest")
):
    file_bytes = await file.read()

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()

    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from PDF")

    profile = await get_profile(user_id)
    await send_session_event(user_id, {"type": "pdf_opened", "filename": file.filename})
    return await stream_transform(text[:4000], "pdf", profile)

# ── Route 3: Plain text lecture input ────────────────────
@app.post("/transform/lecture")
async def transform_lecture(
    text: str = Form(...),
    user_id: str = Form("guest")
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty")

    profile = await get_profile(user_id)
    await send_session_event(user_id, {"type": "lecture_captured"})
    return await stream_transform(text, "lecture", profile)

# ── Route 4: Get profile ──────────────────────────────────
@app.get("/profile/{user_id}")
async def get_user_profile(user_id: str):
    return await get_profile(user_id)

import time

# ── Core media streaming function ─────────────────────────
async def stream_transform_media(file_path: str, mode: str, profile: dict):
    system_prompt = build_prompt(mode, profile)
    
    try:
        # Upload the physical file to Gemini
        gemini_file = client.files.upload(file=file_path)
        
        # Wait for the file to be processed by Google's servers
        while gemini_file.state == "PROCESSING":
            time.sleep(2)
            gemini_file = client.files.get(name=gemini_file.name)
            
        if gemini_file.state == "FAILED":
            raise Exception("Video processing on Google servers failed.")
        
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[gemini_file, system_prompt]
        )
        return JSONResponse({"text": response.text})
    except Exception as e:
        return JSONResponse({"error": f"Media transformation failed. Details: {str(e)}"}, status_code=500)

# ── Route 5: Transform Audio/Video File ───────────────────
@app.post("/transform/media")
async def transform_media(
    file: UploadFile = File(...),
    mode: str = Form("video"), # Usually "video" or "lecture"
    user_id: str = Form("guest")
):
    profile = await get_profile(user_id)
    await send_session_event(user_id, {"type": "media_opened", "filename": file.filename})

    # Save the uploaded media to a temporary file so Gemini can read it
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_media:
        temp_media.write(await file.read())
        temp_media_path = temp_media.name

    try:
        # Transform the media using the temporary file path
        response = await stream_transform_media(temp_media_path, mode, profile)
        return response
    finally:
        # Always clean up the temporary file from the server
        if os.path.exists(temp_media_path):
            os.remove(temp_media_path)
