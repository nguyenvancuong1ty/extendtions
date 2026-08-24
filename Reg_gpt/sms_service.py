"""
SMS-Activate API client module for receiving SMS OTP verification codes.
Supports number reservation, polling for incoming codes, and activation cancellation.
"""

import json
import logging
import os
import time
import urllib.parse
import urllib.request
from typing import Optional, Tuple, Dict, Any

# Configure module logger
logger = logging.getLogger("SMSActivateClient")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class SMSActivateError(Exception):
    """Base exception for SMS-Activate API errors."""
    pass


class SMSActivateTimeoutError(SMSActivateError):
    """Raised when polling for an SMS code times out."""
    pass


class SMSActivateBalanceError(SMSActivateError):
    """Raised when the account balance is insufficient."""
    pass


class SMSActivateNoNumbersError(SMSActivateError):
    """Raised when no phone numbers are available for the service/country."""
    pass


class SMSActivateClient:
    """Client for SMS-Activate.io / SMS-Activate.org REST API."""

    DEFAULT_BASE_URL = "https://api.sms-activate.io/stubs/handler_api.php"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: int = 180,
        poll_interval: int = 5,
        config_path: Optional[str] = None
    ):
        """
        Initialize the SMS-Activate client.
        If parameters are not explicitly passed, attempts to load from config.json.
        """
        self.config_path = config_path or os.path.join(os.path.dirname(__file__), "config.json")
        loaded_cfg = self._load_config()

        sms_cfg = loaded_cfg.get("sms_activate", {})
        self.api_key = api_key or sms_cfg.get("api_key")
        if not self.api_key or self.api_key == "YOUR_SMS_ACTIVATE_API_KEY":
            logger.warning("SMS-Activate API key is not configured or using default placeholder.")

        self.base_url = base_url or sms_cfg.get("base_url", self.DEFAULT_BASE_URL)
        self.timeout = timeout or sms_cfg.get("timeout_seconds", 180)
        self.poll_interval = poll_interval or sms_cfg.get("poll_interval_seconds", 5)

    def _load_config(self) -> Dict[str, Any]:
        """Loads configuration JSON file if it exists."""
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to read config file at {self.config_path}: {e}")
        return {}

    def _send_request(self, params: Dict[str, Any], http_timeout: int = 30) -> str:
        """Sends an HTTP GET request to the SMS-Activate API."""
        if not self.api_key:
            raise SMSActivateError("SMS-Activate API key is required to make requests.")

        params["api_key"] = self.api_key
        query_string = urllib.parse.urlencode(params)
        url = f"{self.base_url}?{query_string}"

        req = urllib.request.Request(
            url=url,
            headers={
                "User-Agent": "SMS-Activate-Python-Client/1.0",
                "Accept": "text/plain, application/json"
            }
        )

        try:
            with urllib.request.urlopen(req, timeout=http_timeout) as response:
                content = response.read().decode("utf-8", errors="replace").strip()
                return content
        except urllib.error.URLError as e:
            raise SMSActivateError(f"HTTP request to SMS-Activate failed: {e}") from e
        except Exception as e:
            raise SMSActivateError(f"Unexpected network error: {e}") from e

    def get_balance(self) -> float:
        """
        Retrieves the account balance.

        Returns:
            float: Current account balance.
        """
        logger.info("Fetching SMS-Activate account balance...")
        response = self._send_request({"action": "getBalance"})

        if response.startswith("ACCESS_BALANCE:"):
            try:
                balance = float(response.split(":")[1])
                logger.info(f"Account balance: {balance}")
                return balance
            except (IndexError, ValueError) as e:
                raise SMSActivateError(f"Malformed balance response: {response}") from e
        elif response == "BAD_KEY":
            raise SMSActivateError("Invalid SMS-Activate API key (BAD_KEY).")
        else:
            raise SMSActivateError(f"Failed to fetch balance: {response}")

    def get_number(
        self,
        service: str = "openai",
        country: str | int = 0,
        operator: Optional[str] = None,
        forward: int = 0
    ) -> Tuple[str, str]:
        """
        Orders a new virtual phone number for a specific service and country.

        Args:
            service (str): Service code (e.g. 'openai', 'tg', 'wa', 'go').
            country (str | int): Country ID (e.g. 0 for Russia, 1 for USA, 6 for Indonesia, etc.).
            operator (str, optional): Desired mobile carrier/operator.
            forward (int, optional): 1 if call/SMS forwarding required, else 0.

        Returns:
            Tuple[str, str]: (activation_id, phone_number)
        """
        logger.info(f"Requesting number for service='{service}', country='{country}'...")
        params: Dict[str, Any] = {
            "action": "getNumber",
            "service": service,
            "country": str(country),
            "forward": str(forward)
        }
        if operator:
            params["operator"] = operator

        response = self._send_request(params)

        # Expected format: ACCESS_NUMBER:12345678:1234567890
        if response.startswith("ACCESS_NUMBER:"):
            parts = response.split(":")
            if len(parts) >= 3:
                activation_id = parts[1]
                phone_number = parts[2]
                logger.info(f"Number acquired: ID={activation_id}, Phone=+{phone_number}")
                return activation_id, phone_number
            raise SMSActivateError(f"Unexpected ACCESS_NUMBER format: {response}")
        elif response == "NO_NUMBERS":
            raise SMSActivateNoNumbersError(f"No numbers available for service '{service}' in country '{country}'.")
        elif response == "NO_BALANCE":
            raise SMSActivateBalanceError("Insufficient SMS-Activate balance.")
        elif response == "BAD_KEY":
            raise SMSActivateError("Invalid SMS-Activate API key.")
        elif response == "BAD_SERVICE":
            raise SMSActivateError(f"Invalid or unsupported service code: '{service}'.")
        else:
            raise SMSActivateError(f"Failed to acquire number: {response}")

    def set_status(self, activation_id: str, status: int) -> str:
        """
        Updates activation status.
        Common status codes:
            1 = Inform that SMS was sent / ready for incoming code
            3 = Request another code
            6 = Finish activation (SMS code accepted)
            8 = Cancel activation (refund balance)

        Args:
            activation_id (str): The ID of the activation.
            status (int): The status code to set.

        Returns:
            str: API response string.
        """
        logger.info(f"Setting activation {activation_id} status to {status}...")
        params = {
            "action": "setStatus",
            "id": activation_id,
            "status": str(status)
        }
        response = self._send_request(params)
        logger.info(f"Status update response: {response}")
        return response

    def cancel_number(self, activation_id: str) -> bool:
        """
        Cancels the activation and releases the number, refunding balance.

        Args:
            activation_id (str): The activation ID to cancel.

        Returns:
            bool: True if canceled successfully.
        """
        logger.info(f"Canceling activation {activation_id}...")
        response = self.set_status(activation_id, status=8)
        if response in ("ACCESS_CANCEL", "ACCESS_ACTIVATION_CANCEL"):
            logger.info(f"Activation {activation_id} successfully canceled.")
            return True
        logger.warning(f"Cancel request returned: {response}")
        return False

    def finish_activation(self, activation_id: str) -> bool:
        """
        Marks the activation as completed after verifying the code.

        Args:
            activation_id (str): The activation ID to complete.

        Returns:
            bool: True if marked completed.
        """
        logger.info(f"Completing activation {activation_id}...")
        response = self.set_status(activation_id, status=6)
        return response in ("ACCESS_ACTIVATION_DONE", "ACCESS_READY")

    def get_sms_code(
        self,
        activation_id: str,
        timeout: Optional[int] = None,
        poll_interval: Optional[int] = None,
        auto_finish: bool = True
    ) -> str:
        """
        Polls the SMS-Activate API until the OTP code is received or timeout occurs.

        Args:
            activation_id (str): Activation ID returned by get_number.
            timeout (int, optional): Max wait time in seconds (defaults to client timeout).
            poll_interval (int, optional): Interval between polls in seconds.
            auto_finish (bool, optional): Automatically complete activation when code is received.

        Returns:
            str: The extracted SMS OTP code.

        Raises:
            SMSActivateTimeoutError: When code is not received within timeout.
            SMSActivateError: On API or cancellation errors.
        """
        timeout_limit = timeout if timeout is not None else self.timeout
        interval = poll_interval if poll_interval is not None else self.poll_interval

        start_time = time.time()
        logger.info(
            f"Waiting for SMS code on activation {activation_id} (timeout={timeout_limit}s, interval={interval}s)..."
        )

        while True:
            elapsed = time.time() - start_time
            if elapsed > timeout_limit:
                logger.error(f"Timed out waiting for SMS code for activation {activation_id} after {elapsed:.1f}s.")
                # Attempt to cancel number on timeout to reclaim funds
                try:
                    self.cancel_number(activation_id)
                except Exception as cancel_err:
                    logger.warning(f"Could not auto-cancel activation on timeout: {cancel_err}")
                raise SMSActivateTimeoutError(
                    f"Timeout waiting for SMS on activation ID {activation_id} after {timeout_limit}s."
                )

            params = {
                "action": "getStatus",
                "id": activation_id
            }

            try:
                response = self._send_request(params)
            except SMSActivateError as req_err:
                logger.warning(f"Transient error querying status: {req_err}. Retrying...")
                time.sleep(interval)
                continue

            # Check response types
            if response.startswith("STATUS_OK:"):
                # Format: STATUS_OK:123456
                code = response.split(":", 1)[1].strip()
                logger.info(f"SMS code received successfully: '{code}' (took {elapsed:.1f}s)")
                if auto_finish:
                    try:
                        self.finish_activation(activation_id)
                    except Exception as finish_err:
                        logger.warning(f"Could not mark activation as finished: {finish_err}")
                return code

            elif response in ("STATUS_WAIT_CODE", "STATUS_WAIT_RETRY"):
                logger.debug(f"Still waiting for SMS (elapsed: {elapsed:.1f}s)...")

            elif response == "STATUS_CANCEL":
                raise SMSActivateError(f"Activation {activation_id} was cancelled remotely.")

            elif response == "NO_ACTIVATION":
                raise SMSActivateError(f"Activation ID {activation_id} does not exist (NO_ACTIVATION).")

            elif response == "BAD_KEY":
                raise SMSActivateError("Invalid SMS-Activate API key.")

            else:
                logger.warning(f"Unexpected status response: {response}")

            time.sleep(interval)


if __name__ == "__main__":
    # Quick self-test / demo
    client = SMSActivateClient()
    print("Initialized SMS-Activate client.")
    print(f"Base URL: {client.base_url}")
    print(f"Timeout: {client.timeout}s, Poll Interval: {client.poll_interval}s")
