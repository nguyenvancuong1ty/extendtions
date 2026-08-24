import time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        user_data_dir='browser_profile',
        executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        headless=False
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto('https://chatgpt.com/', wait_until='domcontentloaded')
    time.sleep(3)
    
    # Click cookie button if present
    cookie_btn = page.query_selector("button:has-text('Accept all')")
    if cookie_btn:
        cookie_btn.click()
        time.sleep(1)

    # Click Sign up for free
    page.get_by_role("button", name="Sign up for free").click()
    time.sleep(3)
    
    # Fill Email address in modal
    email_input = page.locator("input[placeholder*='Email address' i], input[type='email']")
    email_input.wait_for(state="visible", timeout=10000)
    email_input.click()
    test_email = "gpt_cuong01@cuongdev.io.vn"
    for char in test_email:
        page.keyboard.type(char)
        time.sleep(0.05)
    time.sleep(1)

    # Click Continue button
    page.locator("button:has-text('Continue')").last.click()
    time.sleep(5)
    page.screenshot(path="screenshot_step2_after_email.png")
    print("Page URL after Email:", page.url)
    print("Page Title:", page.title())
    ctx.close()
