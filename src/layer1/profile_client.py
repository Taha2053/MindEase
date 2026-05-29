import httpx
import os

LAYER2_URL = os.getenv("LAYER2_URL", "http://localhost:8001")

async def get_profile(user_id: str) -> dict:
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{LAYER2_URL}/profile/{user_id}",
                timeout=3.0
            )
            if response.status_code == 200:
                return response.json()
    except Exception:
        pass

    return {
        "dyslexia": False,
        "adhd": False,
        "esl": False,
        "visual": False
    }

async def send_session_event(user_id: str, event: dict):
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{LAYER2_URL}/event/{user_id}",
                json=event,
                timeout=2.0
            )
    except Exception:
        pass