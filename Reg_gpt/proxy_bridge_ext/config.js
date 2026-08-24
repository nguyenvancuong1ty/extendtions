/**
 * Proxy Bridge Configuration
 * Supported schemes: "http", "https", "socks4", "socks5"
 */
export const DEFAULT_PROXY_CONFIG = {
  enabled: true,
  scheme: "http",
  host: "127.0.0.1",
  port: 8080,
  username: "proxy_username",
  password: "proxy_password",
  bypassList: [
    "localhost",
    "127.0.0.1",
    "<local>"
  ]
};
