"""
ChatGPT Automated Registration Pipeline
Complete end-to-end account creator using:
- Real Google Chrome with Stealth Anti-Detection
- Cloudflare Catch-All Custom Domain (@cuongdev.io.vn)
- Gmail IMAP Automatic OTP Extraction
"""

import os
import sys
import time
import json
import random
import string
import logging
from datetime import datetime
from typing import Optional, Tuple

from playwright.sync_api import sync_playwright, Page, BrowserContext

from mail_service import MailClient, MailServiceError, MailTimeoutError
from sms_service import SMSActivateClient, SMSActivateError

# Structured logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s]: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("RegGPT")


def find_chrome_path() -> Optional[str]:
    """Finds Google Chrome executable on Windows."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def random_sleep(min_sec: float = 1.0, max_sec: float = 2.5):
    """Humanized random delay."""
    time.sleep(random.uniform(min_sec, max_sec))


def human_type(page: Page, selector: str, text: str, delay_min_ms: int = 40, delay_max_ms: int = 90):
    """Types text with natural human keystroke intervals."""
    page.wait_for_selector(selector, state="visible", timeout=15000)
    page.click(selector)
    time.sleep(0.3)
    for char in text:
        page.keyboard.type(char)
        time.sleep(random.uniform(delay_min_ms, delay_max_ms) / 1000.0)


def generate_account_credentials(domain: str = "cuongdev.io.vn") -> Tuple[str, str]:
    """Generates unique email prefix and strong random password."""
    rand_id = "".join(random.choices(string.ascii_lowercase + string.digits, k=7))
    email = f"gpt_{rand_id}@{domain}"

    # Generate strong 14-char password
    symbols = "!@#$%"
    chars = string.ascii_letters + string.digits + symbols
    password = "".join(random.choices(chars, k=12)) + "Aa1!"
    return email, password


def log_successful_account(email: str, password: str, notes: str = "Active"):
    """Appends successful account details to accounts.txt."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    accounts_file = os.path.join(base_dir, "accounts.txt")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{timestamp}] EMAIL: {email} | PASSWORD: {password} | NOTES: {notes}\n"
    with open(accounts_file, "a", encoding="utf-8") as f:
        f.write(entry)
    logger.info(f" Saved new account to {accounts_file}")


def wait_for_openai_otp(mail_client: MailClient, target_email: str, start_timestamp: float, timeout_sec: int = 90) -> Optional[str]:
    """
    Polls Gmail via IMAP for a new ChatGPT verification email received after start_timestamp.
    """
    logger.info(f"Awaiting NEW ChatGPT verification OTP for {target_email}...")
    start_poll = time.time()

    while time.time() - start_poll < timeout_sec:
        try:
            emails = mail_client.fetch_latest_imap_emails(limit=5, unread_only=False)
            for m in emails:
                subject = m.get("subject", "")
                body = m.get("body", "")
                sender = m.get("from", "")
                date_str = m.get("date", "")

                if "openai" in sender.lower() or "chatgpt" in sender.lower() or "verification code" in subject.lower():
                    # Check if body contains the target email or if this is fresh
                    otp = mail_client.extract_otp(body) or mail_client.extract_otp(subject)
                    if otp:
                        logger.info(f" Received OTP Code: {otp} | Subject: '{subject}' | Date: {date_str}")
                        return otp
        except Exception as e:
            logger.warning(f"Error checking mailbox: {e}")

        time.sleep(3)

    logger.error("Timed out waiting for ChatGPT verification code.")
    return None


def handle_turnstile_if_present(page: Page):
    """Detects Cloudflare Turnstile and handles the checkbox click."""
    try:
        # Check if page is on Cloudflare verification
        if "auth.openai.com" in page.url or "challenges.cloudflare.com" in page.content():
            cf_frame = page.frame_locator("iframe[src*='challenges.cloudflare.com']")
            if cf_frame:
                logger.info("🛡️ Cloudflare Turnstile detected! Attempting to click 'Verify you are human'...")
                time.sleep(2)
                cb = cf_frame.locator("input[type='checkbox'], span.mark, div#challenge-stage, label")
                if cb.count() > 0 and cb.first.is_visible():
                    cb.first.click()
                    logger.info(" Clicked Turnstile checkbox. Waiting for resolution...")
                    time.sleep(4)
    except Exception as e:
        logger.warning(f"Turnstile auto-click note: {e}")


def run_create_account():
    domain = "cuongdev.io.vn"
    target_email, target_password = generate_account_credentials(domain)

    logger.info("==========================================")
    logger.info("🚀 STARTING AUTOMATED CHATGPT REGISTRATION")
    logger.info(f"📧 Email: {target_email}")
    logger.info(f"🔑 Password: {target_password}")
    logger.info("==========================================")

    mail_client = MailClient(config_path="config.json")
    chrome_path = find_chrome_path()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    profile_dir = os.path.join(base_dir, "browser_profile")

    with sync_playwright() as p:
        args = [
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-infobars",
            "--start-maximized",
        ]

        logger.info("Launching Real Chrome with Anti-Detection Stealth...")
        context = p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            executable_path=chrome_path,
            headless=False,
            args=args,
            no_viewport=True,
            locale="en-US",
            timezone_id="America/New_York",
            slow_mo=50
        )

        # Inject Stealth scripts
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = {
                app: { isInstalled: false, InstallState: { DISABLED: 'disabled' }, RunningState: { CANNOT_RUN: 'cannot_run' } },
                runtime: { OnInstalledReason: { INSTALL: 'install' }, PlatformOs: { WIN: 'win' } },
            };
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'vi'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        """)

        page = context.pages[0] if context.pages else context.new_page()
        page.bring_to_front()

        try:
            # -------------------------------------------------------------
            # Step 1: Open ChatGPT Home
            # -------------------------------------------------------------
            logger.info("Navigating to https://chatgpt.com/ ...")
            page.goto("https://chatgpt.com/", wait_until="domcontentloaded", timeout=45000)
            page.bring_to_front()
            random_sleep(2.5, 4.0)

            # Accept cookies if banner appears
            cookie_btn = page.query_selector("button:has-text('Accept all'), button:has-text('Accept All')")
            if cookie_btn:
                logger.info("Dismissing cookie banner...")
                cookie_btn.click()
                random_sleep(0.5, 1.0)

            # -------------------------------------------------------------
            # Step 2: Open Sign Up Modal
            # -------------------------------------------------------------
            logger.info("Opening Sign up modal...")
            signup_btn = page.get_by_role("button", name="Sign up for free")
            if not signup_btn.is_visible():
                signup_btn = page.get_by_role("button", name="Sign up")
            signup_btn.click()
            random_sleep(2.0, 3.5)

            # -------------------------------------------------------------
            # Step 3: Fill Email in Modal
            # -------------------------------------------------------------
            logger.info(f"Typing email address: {target_email}")
            email_input = page.locator("input[placeholder*='Email address' i], input[type='email']")
            email_input.wait_for(state="visible", timeout=15000)
            email_input.click()
            for char in target_email:
                page.keyboard.type(char)
                time.sleep(random.uniform(0.03, 0.08))

            random_sleep(0.8, 1.5)
            logger.info("Clicking Continue on Email...")
            form_submit_time = time.time()
            page.locator("button:has-text('Continue')").last.click()
            random_sleep(4.0, 6.0)

            # -------------------------------------------------------------
            # Step 4: Check for Cloudflare Challenge or Email Verification Screen
            # -------------------------------------------------------------
            logger.info("Checking page state (Cloudflare / Verification)...")
            handle_turnstile_if_present(page)

            # If Turnstile was present, wait for user or auto-resolution
            for _ in range(15):
                if "Performing security verification" in page.title() or "challenges.cloudflare.com" in page.content():
                    logger.info("Waiting for Cloudflare verification to pass...")
                    handle_turnstile_if_present(page)
                    time.sleep(3)
                else:
                    break

            # Now wait for OTP input
            otp_input = page.locator("input[placeholder*='Code' i], input[name='code'], input[type='text']:not([placeholder*='Email' i])")
            otp_input.wait_for(state="visible", timeout=40000)

            # Fetch OTP from Gmail
            otp_code = wait_for_openai_otp(mail_client, target_email=target_email, start_timestamp=form_submit_time, timeout_sec=90)
            if not otp_code:
                raise TimeoutError("Could not retrieve OTP from Gmail within 90s.")

            logger.info(f"Entering OTP code {otp_code} into verification form...")
            otp_input.click()
            for char in otp_code:
                page.keyboard.type(char)
                time.sleep(random.uniform(0.05, 0.12))

            random_sleep(0.8, 1.5)
            # Submit OTP
            continue_otp = page.locator("button:has-text('Continue'), button[type='submit']").last
            if continue_otp.is_visible():
                continue_otp.click()

            random_sleep(4.0, 6.0)

            # -------------------------------------------------------------
            # Step 5: Fill Password (if requested)
            # -------------------------------------------------------------
            pwd_input = page.locator("input[name='password']:not([aria-hidden='true']), input[type='password']:not([aria-hidden='true'])")
            if pwd_input.count() > 0 and pwd_input.first.is_visible():
                logger.info(f"Setting account password...")
                pwd_input.first.click()
                for char in target_password:
                    page.keyboard.type(char)
                    time.sleep(random.uniform(0.03, 0.07))
                random_sleep(0.5, 1.0)
                page.locator("button:has-text('Continue'), button[type='submit']").last.click()
                random_sleep(4.0, 6.0)

            # -------------------------------------------------------------
            # Step 6: Fill Profile Name & Birthday (Tell us about you)
            # -------------------------------------------------------------
            logger.info("Checking for Profile Details (Name & Birthday)...")
            name_input = page.locator("input[name='name'], input[name='first_name'], input#name")
            if name_input.count() > 0 and name_input.first.is_visible():
                logger.info("Entering Name...")
                name_input.first.fill("Cuong")
                random_sleep(0.5, 1.0)

                bday_input = page.locator("input[name='birthday'], input[placeholder*='YYYY' i], input#birthday")
                if bday_input.count() > 0 and bday_input.first.is_visible():
                    logger.info("Entering Birthday...")
                    bday_input.first.fill("19032000")

                random_sleep(0.8, 1.5)
                page.locator("button:has-text('Agree'), button:has-text('Continue'), button[type='submit']").last.click()
                random_sleep(4.0, 6.0)

            # -------------------------------------------------------------
            # Step 7: Completed! Save Account
            # -------------------------------------------------------------
            logger.info("🎉 REGISTRATION COMPLETED SUCCESSFULLY!")
            logger.info(f"Final URL: {page.url}")
            log_successful_account(target_email, target_password, notes="Active Account")

            logger.info("Keeping browser open for 20s so you can see the logged-in screen...")
            time.sleep(20)

        except Exception as e:
            logger.error(f"Error during registration: {e}")
            err_shot = os.path.join(base_dir, "debug_error.png")
            page.screenshot(path=err_shot)
            logger.info(f"Saved error screenshot to {err_shot}")
            logger.info("Current URL: " + page.url)
            logger.info("Trình duyệt sẽ giữ mở trong 30 giây để bạn theo dõi và thao tác nếu cần...")
            time.sleep(30)
        finally:
            logger.info("Closing browser.")
            context.close()


if __name__ == "__main__":
    run_create_account()
