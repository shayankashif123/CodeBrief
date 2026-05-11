"""
Google Generative AI client wrapper.

Design decisions:
- Wraps google-generativeai SDK configuration in one place
- genai.configure() is a global call — must happen exactly once at startup
- Provides typed factory methods for the two models we use:
    get_embedding_model() — text-embedding-004
    get_generative_model() — gemini-2.0-flash with our standard config
- Temperature and generation config are centralised here, not scattered
  across service methods — easier to tune globally
- response_mime_type="application/json" on the generative model forces Gemini
  to return raw JSON without markdown code fences — critical for reliable parsing
"""

import google.generativeai as genai
from google.generativeai import GenerativeModel
from google.generativeai.types import GenerationConfig

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def configure_gemini() -> None:
    """
    Configure the Google GenAI SDK.
    Must be called once during app startup (inside lifespan).
    """
    settings = get_settings()
    genai.configure(api_key=settings.GOOGLE_API_KEY)
    logger.info(
        "gemini_configured",
        embedding_model=settings.EMBEDDING_MODEL,
        generative_model=settings.GEMINI_MODEL,
    )


def get_generative_model() -> GenerativeModel:
    """
    Returns a configured GenerativeModel instance for review and doc generation.

    Configuration choices:
    - temperature=0.2: low randomness for consistent, reproducible AI output.
      A review that gives different answers on the same diff is untrustworthy.
    - response_mime_type="application/json": tells Gemini to output raw JSON.
      Without this, Gemini wraps output in ```json ... ``` fences which
      breaks json.loads silently (it parses the first { but ignores the rest).
    - max_output_tokens=8192: generous ceiling — a thorough review needs room.
    """
    settings = get_settings()
    return GenerativeModel(
        model_name=settings.GEMINI_MODEL,
        generation_config=GenerationConfig(
            temperature=0.2,
            max_output_tokens=8192,
            response_mime_type="application/json",
        ),
    )
