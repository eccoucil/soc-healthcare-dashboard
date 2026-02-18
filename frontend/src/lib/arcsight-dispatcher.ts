import "server-only";
import { Agent, ProxyAgent, type Dispatcher } from "undici";
import tls from "node:tls";

const PROXY_URL = process.env.ARCSIGHT_PROXY_URL?.trim() || "";

type ProxyMode = "direct" | "http-proxy" | "socks5";

interface DispatcherConfig {
  connections: number;
  pipelining: number;
  connectTimeout: number;
}

/** Detect which proxy strategy to use based on the URL scheme. */
export function getProxyMode(): ProxyMode {
  if (!PROXY_URL) return "direct";
  if (PROXY_URL.startsWith("socks5://") || PROXY_URL.startsWith("socks5h://"))
    return "socks5";
  if (PROXY_URL.startsWith("http://") || PROXY_URL.startsWith("https://"))
    return "http-proxy";
  throw new Error(
    `Unsupported ARCSIGHT_PROXY_URL scheme: ${PROXY_URL}. Use http://, https://, socks5://, or socks5h://`
  );
}

/** Return a masked proxy URL for safe logging (hides password if present). */
export function getProxyInfo(): string {
  if (!PROXY_URL) return "direct (no proxy)";
  try {
    const u = new URL(PROXY_URL);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return PROXY_URL.replace(/:\/\/.*@/, "://***@");
  }
}

/**
 * Create an undici Dispatcher routed through the configured proxy.
 *
 * - No ARCSIGHT_PROXY_URL → direct Agent (current behaviour)
 * - http:// / https://     → ProxyAgent (HTTP CONNECT tunnel)
 * - socks5:// / socks5h:// → Agent with custom connect via `socks` package
 */
export function createArcsightDispatcher(
  config: DispatcherConfig
): Dispatcher {
  const mode = getProxyMode();

  if (mode === "direct") {
    return new Agent({
      connect: { rejectUnauthorized: false },
      connections: config.connections,
      pipelining: config.pipelining,
      connectTimeout: config.connectTimeout,
    });
  }

  if (mode === "http-proxy") {
    return new ProxyAgent({
      uri: PROXY_URL,
      requestTls: { rejectUnauthorized: false },
      connections: config.connections,
      pipelining: config.pipelining,
    });
  }

  // --- SOCKS5 proxy ---
  // Lazy-import `socks` so it's only needed when SOCKS is configured.
  // socks5h:// means DNS resolution happens on the proxy side.
  const parsed = new URL(PROXY_URL);
  const socksHost = parsed.hostname;
  const socksPort = parseInt(parsed.port || "1080", 10);
  const resolveHostRemotely = PROXY_URL.startsWith("socks5h://");

  return new Agent({
    connections: config.connections,
    pipelining: config.pipelining,
    connectTimeout: config.connectTimeout,
    connect: async (opts, cb) => {
      try {
        // Dynamic import — only loaded when SOCKS proxy is active
        const { SocksClient } = await import("socks");

        const targetHost = (opts as { hostname?: string }).hostname ?? "localhost";
        const rawPort = (opts as { port?: string | number }).port;
        const targetPort = typeof rawPort === "string" ? parseInt(rawPort, 10) : (rawPort ?? 443);

        const { socket: rawSocket } = await SocksClient.createConnection({
          proxy: {
            host: socksHost,
            port: socksPort,
            type: 5, // SOCKS5
          },
          command: "connect",
          destination: {
            host: resolveHostRemotely ? targetHost : targetHost,
            port: targetPort,
          },
          timeout: config.connectTimeout,
        });

        // TLS-wrap the raw TCP socket for HTTPS targets
        const tlsSocket = tls.connect({
          socket: rawSocket,
          servername: targetHost,
          rejectUnauthorized: false,
        });

        tlsSocket.on("secureConnect", () => {
          cb(null, tlsSocket);
        });

        tlsSocket.on("error", (err) => {
          cb(err, null);
        });
      } catch (err) {
        cb(err as Error, null);
      }
    },
  });
}
