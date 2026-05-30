from groq import AsyncGroq
from config import get_settings


async def groq_generate(
    system_prompt: str, user_message: str, max_tokens: int = 1024
) -> str:
    settings = get_settings()
    client = AsyncGroq(api_key=settings.groq_api_key)
    response = await client.chat.completions.create(
        model=settings.groq_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        max_tokens=max_tokens,
        temperature=0.7,
        timeout=30,
    )
    return response.choices[0].message.content or ""
