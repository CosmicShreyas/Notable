import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings


class EmailService:
    def __init__(self) -> None:
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.username = settings.smtp_username
        self.password = settings.smtp_password
        self.from_email = settings.smtp_from_email or settings.smtp_username
        self.from_name = settings.smtp_from_name

    def ensure_configured(self) -> None:
        if not self.username or not self.password or not self.from_email:
            raise ValueError("SMTP credentials are not configured")

    def send_html_email(self, *, to_email: str, subject: str, html: str, text: str) -> None:
        self.ensure_configured()

        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = to_email
        message.attach(MIMEText(text, "plain", "utf-8"))
        message.attach(MIMEText(html, "html", "utf-8"))

        with smtplib.SMTP(self.host, self.port) as server:
            server.starttls()
            server.login(self.username, self.password)
            server.sendmail(self.from_email, [to_email], message.as_string())
