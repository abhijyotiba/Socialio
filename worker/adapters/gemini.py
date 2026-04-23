from google import genai
from google.genai import types
from config import get_settings


async def gemini_generate(system_prompt: str, user_message: str) -> str:
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)
    
    response = await client.aio.models.generate_content(
        model=settings.gemini_model,
        contents=user_message,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
        )
    )
    return response.text
