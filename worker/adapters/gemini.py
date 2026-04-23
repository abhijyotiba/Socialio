import google.generativeai as genai
from config import get_settings


async def gemini_generate(system_prompt: str, user_message: str) -> str:
    settings = get_settings()
    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(
        settings.gemini_model,
        system_instruction=system_prompt,
    )
    response = await model.generate_content_async(user_message)
    return response.text
