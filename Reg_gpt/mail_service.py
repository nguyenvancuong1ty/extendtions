"""
Mail service module for retrieving emails, parsing OTP verification codes,
and extracting activation links via IMAP or custom REST Webmail APIs.
"""

import email
from email.header import decode_header
import imaplib
import json
import logging
import os
import re
import time
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any, List, Tuple

logger = logging.getLogger("MailService")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class MailServiceError(Exception):
    """Base exception for Mail Service errors."""
    pass


class MailTimeoutError(MailServiceError):
    """Raised when waiting for an email or verification code times out."""
    pass


class MailClient:
    """
    Mail client supporting IMAP and REST API backends.
    Handles message retrieval, HTML/plain-text decoding, OTP extraction, and URL verification.
    """

    DEFAULT_OTP_REGEX = r"\b(?:code\s*[:is]?\s*|OTP\s*[:is]?\s*|verification\s*code\s*[:is]?\s*)?(\d{6})\b"
    DEFAULT_LINK_REGEX = r"https?://[^\s\"'<>]+(?:verify|confirm|activate|token|signup)[^\s\"'<>]*(?!\s)"

    def __init__(
        self,
        mode: Optional[str] = None,
        imap_config: Optional[Dict[str, Any]] = None,
        rest_config: Optional[Dict[str, Any]] = None,
        timeout: int = 180,
        poll_interval: int = 5,
        config_path: Optional[str] = None
    ):
        """
        Initialize MailClient with either IMAP or REST configuration.
        """
        self.config_path = config_path or os.path.join(os.path.dirname(__file__), "config.json")
        loaded_cfg = self._load_config()

        mail_cfg = loaded_cfg.get("mail", {})
        self.mode = (mode or mail_cfg.get("mode", "imap")).lower()
        self.imap_config = imap_config or mail_cfg.get("imap", {})
        self.rest_config = rest_config or mail_cfg.get("rest_api", {})

        self.timeout = timeout or mail_cfg.get("timeout_seconds", 180)
        self.poll_interval = poll_interval or mail_cfg.get("poll_interval_seconds", 5)
        self.otp_regex = mail_cfg.get("otp_regex", self.DEFAULT_OTP_REGEX)
        self.link_regex = mail_cfg.get("link_regex", self.DEFAULT_LINK_REGEX)

        self._imap_conn: Optional[imaplib.IMAP4_SSL | imaplib.IMAP4] = None

    def _load_config(self) -> Dict[str, Any]:
        """Loads configuration JSON file if it exists."""
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to read config file at {self.config_path}: {e}")
        return {}

    # -------------------------------------------------------------------------
    # Context Manager Support
    # -------------------------------------------------------------------------
    def __enter__(self):
        if self.mode == "imap":
            self.connect_imap()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    # -------------------------------------------------------------------------
    # IMAP Operations
    # -------------------------------------------------------------------------
    def connect_imap(self):
        """Connects and authenticates to the IMAP server."""
        if self._imap_conn:
            return

        host = self.imap_config.get("host")
        port = self.imap_config.get("port", 993)
        use_ssl = self.imap_config.get("use_ssl", True)
        username = self.imap_config.get("username")
        password = self.imap_config.get("password")

        if not host or not username or not password:
            raise MailServiceError("IMAP connection details (host, username, password) are missing.")

        logger.info(f"Connecting to IMAP server {host}:{port} (SSL={use_ssl})...")
        try:
            if use_ssl:
                self._imap_conn = imaplib.IMAP4_SSL(host, port)
            else:
                self._imap_conn = imaplib.IMAP4(host, port)

            self._imap_conn.login(username, password)
            logger.info("IMAP login successful.")
        except Exception as e:
            self._imap_conn = None
            raise MailServiceError(f"Failed to connect/login to IMAP server: {e}") from e

    def close(self):
        """Closes active IMAP connections."""
        if self._imap_conn:
            try:
                self._imap_conn.close()
            except Exception:
                pass
            try:
                self._imap_conn.logout()
            except Exception:
                pass
            self._imap_conn = None
            logger.info("IMAP connection closed.")

    @staticmethod
    def _decode_mime_header(header_str: Optional[str]) -> str:
        """Decodes RFC 2047 encoded MIME header strings."""
        if not header_str:
            return ""
        decoded_fragments = decode_header(header_str)
        result = []
        for text, encoding in decoded_fragments:
            if isinstance(text, bytes):
                result.append(text.decode(encoding or "utf-8", errors="replace"))
            else:
                result.append(str(text))
        return "".join(result)

    def _extract_body_from_email_message(self, msg: email.message.Message) -> str:
        """Extracts plain text and HTML content from an email message object."""
        body_parts = []
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition", ""))
                if "attachment" in content_disposition:
                    continue

                if content_type in ("text/plain", "text/html"):
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        body_parts.append(payload.decode(charset, errors="replace"))
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                body_parts.append(payload.decode(charset, errors="replace"))

        return "\n\n".join(body_parts)

    def fetch_latest_imap_emails(
        self,
        folder: Optional[str] = None,
        limit: int = 5,
        unread_only: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Fetches the latest emails from IMAP folder.

        Returns:
            List[Dict[str, Any]]: List of email dicts containing subject, from, to, date, body.
        """
        self.connect_imap()
        folder_name = folder or self.imap_config.get("folder", "INBOX")

        status, _ = self._imap_conn.select(folder_name)
        if status != "OK":
            raise MailServiceError(f"Failed to select IMAP folder: {folder_name}")

        search_criteria = "UNSEEN" if unread_only else "ALL"
        status, data = self._imap_conn.search(None, search_criteria)
        if status != "OK" or not data or not data[0]:
            return []

        message_ids = data[0].split()
        target_ids = message_ids[-limit:] if limit > 0 else message_ids
        target_ids.reverse()  # Newest first

        emails = []
        for msg_id in target_ids:
            res_status, msg_data = self._imap_conn.fetch(msg_id, "(RFC822)")
            if res_status != "OK" or not msg_data:
                continue

            raw_email = msg_data[0][1]
            if not isinstance(raw_email, bytes):
                continue

            parsed_msg = email.message_from_bytes(raw_email)
            subject = self._decode_mime_header(parsed_msg.get("Subject"))
            sender = self._decode_mime_header(parsed_msg.get("From"))
            recipient = self._decode_mime_header(parsed_msg.get("To"))
            date_str = parsed_msg.get("Date", "")
            body = self._extract_body_from_email_message(parsed_msg)

            emails.append({
                "id": msg_id.decode("utf-8", errors="ignore"),
                "subject": subject,
                "from": sender,
                "to": recipient,
                "date": date_str,
                "body": body
            })

        return emails

    # -------------------------------------------------------------------------
    # REST API Operations
    # -------------------------------------------------------------------------
    def fetch_latest_rest_emails(self, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Fetches emails using a custom Webmail REST API.
        Expected JSON response: {"messages": [{"subject": "...", "from": "...", "body": "..."}]}
        """
        base_url = self.rest_config.get("base_url")
        token = self.rest_config.get("api_token")
        mailbox = self.rest_config.get("mailbox_id")

        if not base_url:
            raise MailServiceError("REST API base_url is not configured.")

        params = {"mailbox": mailbox, "limit": limit} if mailbox else {"limit": limit}
        url = f"{base_url.rstrip('/')}/messages?{urllib.parse.urlencode(params)}"

        headers = {
            "Accept": "application/json",
            "User-Agent": "MailService-Client/1.0"
        }
        if token and token != "YOUR_MAIL_API_TOKEN":
            headers["Authorization"] = f"Bearer {token}"

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                messages = data.get("messages", data if isinstance(data, list) else [])
                return [
                    {
                        "id": str(m.get("id", "")),
                        "subject": m.get("subject", ""),
                        "from": m.get("from", ""),
                        "to": m.get("to", ""),
                        "date": m.get("date", ""),
                        "body": m.get("body", m.get("text", m.get("html", "")))
                    }
                    for m in messages
                ]
        except Exception as e:
            raise MailServiceError(f"REST API request failed: {e}") from e

    # -------------------------------------------------------------------------
    # Unified Retrieval & Parsing
    # -------------------------------------------------------------------------
    def fetch_emails(self, limit: int = 5, unread_only: bool = False) -> List[Dict[str, Any]]:
        """Unified method to fetch latest emails according to active mode."""
        if self.mode == "rest":
            return self.fetch_latest_rest_emails(limit=limit)
        return self.fetch_latest_imap_emails(limit=limit, unread_only=unread_only)

    @classmethod
    def extract_otp(cls, text: str, custom_regex: Optional[str] = None) -> Optional[str]:
        """
        Extracts numeric OTP code from email text or HTML using regex.

        Args:
            text (str): Email subject or body content.
            custom_regex (str, optional): Custom regular expression.

        Returns:
            Optional[str]: Extracted OTP code if found, else None.
        """
        pattern = custom_regex or cls.DEFAULT_OTP_REGEX
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            # If the regex has a capture group, return group 1; otherwise full match
            return match.group(1) if match.groups() else match.group(0)
        return None

    @classmethod
    def extract_link(cls, text: str, custom_regex: Optional[str] = None) -> Optional[str]:
        """
        Extracts verification / activation link from email body using regex.

        Args:
            text (str): Email content (plain text or HTML).
            custom_regex (str, optional): Custom regular expression.

        Returns:
            Optional[str]: Extracted URL if found, else None.
        """
        pattern = custom_regex or cls.DEFAULT_LINK_REGEX
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            link = match.group(0).strip()
            # Clean common trailing punctuation in URLs from text
            return re.sub(r"[\"'\)\]\.\,]$", "", link)
        return None

    def wait_for_email(
        self,
        filter_subject: Optional[str] = None,
        filter_sender: Optional[str] = None,
        timeout: Optional[int] = None,
        poll_interval: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Polls mailbox until a matching email is found or timeout occurs.

        Args:
            filter_subject (str, optional): Substring or keyword in email subject.
            filter_sender (str, optional): Substring or email address of sender.
            timeout (int, optional): Max seconds to wait.
            poll_interval (int, optional): Polling interval in seconds.

        Returns:
            Dict[str, Any]: Matched email record.
        """
        timeout_limit = timeout if timeout is not None else self.timeout
        interval = poll_interval if poll_interval is not None else self.poll_interval

        start_time = time.time()
        logger.info(
            f"Waiting for incoming email (subject='{filter_subject}', sender='{filter_sender}', timeout={timeout_limit}s)..."
        )

        while True:
            elapsed = time.time() - start_time
            if elapsed > timeout_limit:
                raise MailTimeoutError(
                    f"Timed out waiting for email after {timeout_limit}s "
                    f"(filter_subject='{filter_subject}', filter_sender='{filter_sender}')."
                )

            try:
                emails = self.fetch_emails(limit=10)
                for email_msg in emails:
                    match_sub = True
                    match_snd = True

                    if filter_subject:
                        match_sub = filter_subject.lower() in email_msg["subject"].lower()
                    if filter_sender:
                        match_snd = filter_sender.lower() in email_msg["from"].lower()

                    if match_sub and match_snd:
                        logger.info(f"Matching email found: '{email_msg['subject']}' from '{email_msg['from']}'")
                        return email_msg

            except MailServiceError as e:
                logger.warning(f"Transient error polling mailbox: {e}. Retrying in {interval}s...")

            time.sleep(interval)

    def wait_for_otp(
        self,
        filter_subject: Optional[str] = None,
        filter_sender: Optional[str] = None,
        timeout: Optional[int] = None,
        poll_interval: Optional[int] = None,
        otp_regex: Optional[str] = None
    ) -> str:
        """
        Waits for an incoming email and extracts the verification OTP code.

        Returns:
            str: Extracted OTP code.
        """
        email_msg = self.wait_for_email(
            filter_subject=filter_subject,
            filter_sender=filter_sender,
            timeout=timeout,
            poll_interval=poll_interval
        )

        combined_text = f"{email_msg['subject']}\n{email_msg['body']}"
        code = self.extract_otp(combined_text, custom_regex=otp_regex or self.otp_regex)

        if not code:
            raise MailServiceError(f"Email received ('{email_msg['subject']}'), but failed to extract OTP code.")

        logger.info(f"Extracted OTP code: '{code}'")
        return code

    def wait_for_link(
        self,
        filter_subject: Optional[str] = None,
        filter_sender: Optional[str] = None,
        timeout: Optional[int] = None,
        poll_interval: Optional[int] = None,
        link_regex: Optional[str] = None
    ) -> str:
        """
        Waits for an incoming email and extracts the verification link.

        Returns:
            str: Extracted verification URL.
        """
        email_msg = self.wait_for_email(
            filter_subject=filter_subject,
            filter_sender=filter_sender,
            timeout=timeout,
            poll_interval=poll_interval
        )

        link = self.extract_link(email_msg["body"], custom_regex=link_regex or self.link_regex)

        if not link:
            raise MailServiceError(f"Email received ('{email_msg['subject']}'), but no verification link found.")

        logger.info(f"Extracted verification link: '{link}'")
        return link


if __name__ == "__main__":
    # Test initialization
    client = MailClient()
    print(f"Initialized MailClient with mode: {client.mode}")
    print(f"Configured timeout: {client.timeout}s, poll_interval: {client.poll_interval}s")

    # Regex test demonstration
    sample_text = "Your OpenAI verification code is 849201. Please enter it to verify your account."
    extracted = MailClient.extract_otp(sample_text)
    print(f"Regex extraction demo on test string -> Code: {extracted}")
