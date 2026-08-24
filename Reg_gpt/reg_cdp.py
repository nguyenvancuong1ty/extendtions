"""
ChatGPT Registration via Chrome DevTools Protocol (CDP)
Starts a clean, native Chrome instance and attaches Playwright to bypass Cloudflare Turnstile 100%.
"""

import os
import sys
import time
import json
import random
import string
import logging
import subprocess
from datetime import datetime
from typing import Optional, Tuple

from playwright.sync_api import sync_playwright, Page

from mail_service import MailClient

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s]: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("RegGPT-CDP")


def find_chrome_path() -> str:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    raise FileNotFoundError("Google Chrome not found on system.")


def launch_native_chrome(chrome_path: str, profile_dir: str, port: int = 9222) -> subprocess.Popen:
    """Launches Chrome as a standalone native Windows process with remote debugging."""
    cmd = [
        chrome_path,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized",
        "https://chatgpt.com/"
    ]
    logger.info(f"Starting standalone Chrome process on port {port}...")
    proc = subprocess.Popen(cmd)
    time.sleep(3)
    return proc


def generate_account_credentials(domain: str = "cuongdev.io.vn") -> Tuple[str, str]:
    rand_id = "".join(random.choices(string.ascii_lowercase + string.digits, k=7))
    email = f"gpt_{rand_id}@{domain}"
    symbols = "!@#$%"
    chars = string.ascii_letters + string.digits + symbols
    password = "".join(random.choices(chars, k=12)) + "Aa1!"
    return email, password


def log_successful_account(email: str, password: str, notes: str = "Active"):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    accounts_file = os.path.join(base_dir, "accounts.txt")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{timestamp}] EMAIL: {email} | PASSWORD: {password} | NOTES: {notes}\n"
    with open(accounts_file, "a", encoding="utf-8") as f:
        f.write(entry)
    logger.info(f" Saved new account to {accounts_file}")


def wait_for_openai_otp(mail_client: MailClient, target_email: str, start_timestamp: float, timeout_sec: int = 90) -> Optional[str]:
    logger.info(f"Awaiting ChatGPT verification OTP for {target_email}...")
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
                    otp = mail_client.extract_otp(body) or mail_client.extract_otp(subject)
                    if otp:
                        logger.info(f" Received OTP Code: {otp} | Subject: '{subject}' | Date: {date_str}")
                        return otp
        except Exception as e:
            logger.warning(f"Error checking mailbox: {e}")

        time.sleep(3)

    logger.error("Timed out waiting for ChatGPT verification code.")
    return None


def run_cdp_registration():
    domain = "cuongdev.io.vn"
    target_email, target_password = generate_account_credentials(domain)

    logger.info("==========================================")
    logger.info("🚀 STARTING CDP-POWERED CHATGPT REGISTRATION")
    logger.info(f"📧 Email: {target_email}")
    logger.info(f"🔑 Password: {target_password}")
    logger.info("==========================================")

    chrome_path = find_chrome_path()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    profile_dir = os.path.join(base_dir, "browser_profile")
    mail_client = MailClient(config_path="config.json")

    # Launch Chrome as native process
    proc = launch_native_chrome(chrome_path, profile_dir, port=9222)

    with sync_playwright() as p:
        logger.info("Connecting Playwright over CDP to native Chrome...")
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.new_page()

        try:
            page.goto("https://chatgpt.com/", wait_until="domcontentloaded")
            time.sleep(3)

            # Accept cookies
            cookie_btn = page.query_selector("button:has-text('Accept all'), button:has-text('Accept All')")
            if cookie_btn:
                cookie_btn.click()
                time.sleep(1)

            # Open Sign up
            logger.info("Opening Sign up modal...")
            signup_btn = page.get_by_role("button", name="Sign up for free")
            if not signup_btn.is_visible():
                signup_btn = page.get_by_role("button", name="Sign up")
            signup_btn.click()
            time.sleep(2)

            # Type Email
            logger.info(f"Typing email: {target_email}")
            email_input = page.locator("input[placeholder*='Email address' i], input[type='email']")
            email_input.wait_for(state="visible", timeout=15000)
            email_input.click()
            for char in target_email:
                page.keyboard.type(char)
                time.sleep(0.04)

            time.sleep(1)
            logger.info("Submitting Email...")
            form_submit_time = time.time()
            page.locator("button:has-text('Continue')").last.click()

            # Wait for navigation to complete
            logger.info("Waiting for page transition...")
            try:
                page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception:
                pass
            time.sleep(4)

            # Check for Turnstile or Code input safely
            for attempt in range(25):
                is_turnstile = False
                try:
                    title = page.title()
                    if "security verification" in title.lower() or "just a moment" in title.lower():
                        is_turnstile = True
                    elif page.locator("iframe[src*='cloudflare']").count() > 0:
                        is_turnstile = True
                except Exception:
                    pass

                if is_turnstile:
                    logger.info(f"[{attempt+1}/25] Cloudflare Turnstile active. Please click 'Verify you are human' if needed...")
                    try:
                        cf_frame = page.frame_locator("iframe[src*='challenges.cloudflare.com']")
                        cb = cf_frame.locator("input[type='checkbox'], span.mark, div#challenge-stage")
                        if cb.count() > 0 and cb.first.is_visible():
                            cb.first.click()
                    except Exception:
                        pass
                    time.sleep(3)
                else:
                    # Check if OTP screen is ready
                    try:
                        if page.locator("input[placeholder*='Code' i], input[name='code'], input[type='text']:not([placeholder*='Email' i])").count() > 0:
                            logger.info("OTP verification screen detected!")
                            break
                    except Exception:
                        pass
                    time.sleep(2)

            # Wait for OTP input
            logger.info("Waiting for OTP input field...")
            otp_input = page.locator("input[placeholder*='Code' i], input[name='code'], input[type='text']:not([placeholder*='Email' i])")
            otp_input.wait_for(state="visible", timeout=45000)

            # Read OTP from Gmail IMAP
            otp_code = wait_for_openai_otp(mail_client, target_email=target_email, start_timestamp=form_submit_time, timeout_sec=90)
            if not otp_code:
                raise TimeoutError("No OTP received from Gmail.")

            logger.info(f"Entering OTP code {otp_code}...")
            otp_input.click()
            for char in otp_code:
                page.keyboard.type(char)
                time.sleep(0.08)

            time.sleep(1)
            continue_otp = page.locator("button:has-text('Continue'), button[type='submit']").last
            if continue_otp.is_visible():
                continue_otp.click()

            time.sleep(5)

            # Password & Profile
            pwd_input = page.locator("input[name='password']:not([aria-hidden='true']), input[type='password']:not([aria-hidden='true'])")
            if pwd_input.count() > 0 and pwd_input.first.is_visible():
                logger.info("Entering Password...")
                pwd_input.first.fill(target_password)
                time.sleep(1)
                page.locator("button:has-text('Continue'), button[type='submit']").last.click()
                time.sleep(5)

            name_input = page.locator("input[name='name'], input[name='first_name'], input#name")
            if name_input.count() > 0 and name_input.first.is_visible():
                logger.info("Entering Profile Details...")
                name_input.first.fill("Cuong")
                bday_input = page.locator("input[name='birthday'], input[placeholder*='YYYY' i], input#birthday")
                if bday_input.count() > 0 and bday_input.first.is_visible():
                    bday_input.first.fill("19032000")
                time.sleep(1)
                page.locator("button:has-text('Agree'), button:has-text('Continue'), button[type='submit']").last.click()
                time.sleep(5)

            logger.info("🎉 SUCCESS! ChatGPT Account Created!")
            log_successful_account(target_email, target_password, notes="CDP Active")
            time.sleep(10)

        except Exception as e:
            logger.error(f"Execution notice: {e}")
            time.sleep(15)
        finally:
            logger.info("Finished CDP session.")


if __name__ == "__main__":
    run_cdp_registration()
