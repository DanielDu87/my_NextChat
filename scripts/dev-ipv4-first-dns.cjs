// 仅用于本地 Docker 开发容器（docker-compose.yml 的 nextchat-dev 通过 NODE_OPTIONS --require 加载）。
//
// 背景：宿主机代理（如 Shadowrocket 的 198.18.0.2 DNS）对部分域名只应答 A 记录、不应答 AAAA；
// Alpine/musl 的 getaddrinfo 默认同时查 A + AAAA，会等 AAAA 超时 5s 后整体失败（EAI_AGAIN）。
// 这里在调用方未指定 family 时先只查 IPv4，失败再回退到原始 lookup，IPv6-only 域名仍可解析。
const dns = require("node:dns");

const originalLookup = dns.lookup;

function ipv4FirstLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (typeof options === "number") {
    options = { family: options };
  } else {
    options = { ...(options || {}) };
  }

  if (options.family === 4 || options.family === 6) {
    return originalLookup.call(dns, hostname, options, callback);
  }

  return originalLookup.call(
    dns,
    hostname,
    { ...options, family: 4 },
    (error, address, family) => {
      if (!error) {
        callback(null, address, family);
        return;
      }
      originalLookup.call(dns, hostname, options, callback);
    },
  );
}

dns.lookup = ipv4FirstLookup;
