"""
Test Script: Launch Real Chrome with Stealth and Navigate to ChatGPT
"""

import os
import sys
import time
import logging
from playwright.sync_api import sync_playwright

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s]: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("TestRealChrome")


def find_chrome_path() -> str:
    """Finds Google Chrome executable on the system."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for path in candidates:
        if os.path.exists(path):
            logger.info(f"Found browser binary: {path}")
            return path
    raise FileNotFoundError("Google Chrome not found on system.")


def run_test():
    chrome_path = find_chrome_path()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    profile_dir = os.path.join(base_dir, "browser_profile")

    logger.info(f"Using Chrome profile directory: {profile_dir}")

    with sync_playwright() as p:
        args = [
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-infobars",
            "--start-maximized",
        ]

        logger.info("Launching Real Chrome in headful mode...")
        context = p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            executable_path=chrome_path,
            headless=False,
            args=args,
            no_viewport=True,
            locale="en-US",
        )

        # Inject Stealth scripts to hide Playwright fingerprints
        context.add_init_script("""
            // 1. Hide webdriver flag
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });

            // 2. Mock chrome object
            window.chrome = {
                app: { isInstalled: false, InstallState: { DISABLED: 'disabled' }, RunningState: { CANNOT_RUN: 'cannot_run' } },
                runtime: { OnInstalledReason: { INSTALL: 'install' }, PlatformOs: { WIN: 'win' } },
            };

            // 3. Mock languages & plugins
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en', 'vi']
            });
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
        """)

        page = context.pages[0] if context.pages else context.new_page()

        try:
            target_url = "https://chatgpt.com/"
            logger.info(f"Navigating to {target_url} ...")
            page.goto(target_url, wait_until="domcontentloaded", timeout=45000)

            # Wait a few seconds for any Cloudflare challenge to pass
            time.sleep(5)
            logger.info(f"Current page title: {page.title()}")
            logger.info(f"Current page URL: {page.url}")

            # Check for common ChatGPT buttons
            login_btn = page.query_selector("button[data-testid='login-button'], a[href*='login'], button:has-text('Log in')")
            signup_btn = page.query_selector("button[data-testid='signup-button'], a[href*='signup'], button:has-text('Sign up')")

            if signup_btn:
                logger.info(" Sign up button detected successfully on ChatGPT page!")
            elif login_btn:
                logger.info(" Log in button detected successfully on ChatGPT page!")
            else:
                logger.info("Page loaded. Checking for Cloudflare or other elements...")

            logger.info("Trình duyệt sẽ giữ mở trong 10 giây để bạn quan sát...")
            time.sleep(10)

        except Exception as e:
            logger.error(f"Error during test: {e}")
        finally:
            logger.info("Đóng trình duyệt test.")
            context.close()


if __name__ == "__main__":
    run_test()
