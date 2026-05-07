from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserResponse


class GoogleLoginResponse(BaseModel):
    authorization_url: str
    provider: str


class GoogleCallbackResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserResponse

    model_config = ConfigDict(from_attributes=True)
