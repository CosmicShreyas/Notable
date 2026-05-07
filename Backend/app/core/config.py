from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="Notable API", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    app_debug: bool = Field(default=True, alias="APP_DEBUG")
    api_v1_str: str = Field(default="/api/v1", alias="API_V1_STR")
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8000, alias="APP_PORT")
    frontend_url: str = Field(default="http://localhost:3000", alias="FRONTEND_URL")
    cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:5173,http://localhost:8080",
        alias="CORS_ORIGINS",
    )

    secret_key: str = Field(default="change-me", alias="SECRET_KEY")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(default=1440, alias="ACCESS_TOKEN_EXPIRE_MINUTES")

    mongodb_url: str = Field(default="mongodb://localhost:27017", alias="MONGODB_URL")
    mongodb_db_name: str = Field(default="notable", alias="MONGODB_DB_NAME")

    transcription_provider: str = Field(default="deepgram", alias="TRANSCRIPTION_PROVIDER")
    transcription_language: str | None = Field(default=None, alias="TRANSCRIPTION_LANGUAGE")
    transcription_timeout_seconds: int = Field(default=180, alias="TRANSCRIPTION_TIMEOUT_SECONDS")

    deepgram_api_key: str | None = Field(default=None, alias="DEEPGRAM_API_KEY")
    deepgram_model: str = Field(default="nova-3", alias="DEEPGRAM_MODEL")

    azure_speech_key: str | None = Field(default=None, alias="AZURE_SPEECH_KEY")
    azure_speech_region: str | None = Field(default=None, alias="AZURE_SPEECH_REGION")
    azure_speech_endpoint: str | None = Field(default=None, alias="AZURE_SPEECH_ENDPOINT")
    azure_speech_auto_detect_languages: str = Field(
        default="en-US,hi-IN,kn-IN",
        alias="AZURE_SPEECH_AUTO_DETECT_LANGUAGES",
    )

    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_chat_model: str = Field(default="llama3.1:8b", alias="OLLAMA_CHAT_MODEL")
    ollama_timeout_seconds: int = Field(default=90, alias="OLLAMA_TIMEOUT_SECONDS")

    google_client_id: str | None = Field(default=None, alias="GOOGLE_CLIENT_ID")
    google_client_secret: str | None = Field(default=None, alias="GOOGLE_CLIENT_SECRET")
    google_redirect_uri: str = Field(
        default="http://localhost:8000/api/v1/auth/google/callback",
        alias="GOOGLE_REDIRECT_URI",
    )
    google_post_login_redirect_url: str = Field(
        default="http://localhost:5173/login",
        alias="GOOGLE_POST_LOGIN_REDIRECT_URL",
    )
    google_meet_media_api_enabled: bool = Field(default=False, alias="GOOGLE_MEET_MEDIA_API_ENABLED")
    google_meet_cloud_project_number: str | None = Field(default=None, alias="GOOGLE_MEET_CLOUD_PROJECT_NUMBER")
    google_meet_addon_base_url: str | None = Field(default=None, alias="GOOGLE_MEET_ADDON_BASE_URL")
    google_calendar_scopes: str = Field(
        default=(
            "openid,email,profile,"
            "https://www.googleapis.com/auth/calendar,"
            "https://www.googleapis.com/auth/gmail.readonly,"
            "https://www.googleapis.com/auth/drive.readonly"
        ),
        alias="GOOGLE_CALENDAR_SCOPES",
    )
    smtp_host: str = Field(default="smtp.gmail.com", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_username: str | None = Field(default=None, alias="SMTP_USERNAME")
    smtp_password: str | None = Field(default=None, alias="SMTP_PASSWORD")
    smtp_from_email: str | None = Field(default=None, alias="SMTP_FROM_EMAIL")
    smtp_from_name: str = Field(default="Notable", alias="SMTP_FROM_NAME")
    recordings_storage_dir: str = Field(default="Backend/storage/recordings", alias="RECORDINGS_STORAGE_DIR")

    @property
    def google_scopes(self) -> list[str]:
        return [scope.strip() for scope in self.google_calendar_scopes.split(",") if scope.strip()]

    @property
    def allowed_cors_origins(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if self.frontend_url not in origins:
            origins.append(self.frontend_url)
        return origins

    @property
    def azure_auto_detect_languages(self) -> list[str]:
        return [
            language.strip()
            for language in self.azure_speech_auto_detect_languages.split(",")
            if language.strip()
        ]

    @property
    def recordings_storage_path(self) -> Path:
        configured = Path(self.recordings_storage_dir)
        if configured.is_absolute():
            return configured
        return Path(__file__).resolve().parents[3] / configured


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
