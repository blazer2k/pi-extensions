import { lookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

const blockedAddresses = new BlockList();
// Conservatively exclude non-public and special-use destinations.
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 96],
  ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  const family = isIP(host);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "local" ||
    host.endsWith(".local") ||
    (family !== 0 &&
      blockedAddresses.check(host, family === 4 ? "ipv4" : "ipv6"))
  );
}

export const lookupPublic: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const first = addresses[0];
    if (!first)
      return callback(new Error(`No addresses found for ${hostname}`), "", 0);
    if (
      addresses.some(
        ({ address }) => !isIP(address) || isPrivateHostname(address),
      )
    ) {
      return callback(
        new Error(`Private or non-public address blocked for ${hostname}`),
        "",
        0,
      );
    }
    // Return the checked addresses directly to the socket, without another lookup.
    if (options.all) return callback(null, addresses);
    callback(null, first.address, first.family);
  });
};

export function getValidUrl(
  value: string,
  allowPrivateUrls: boolean,
): string | null {
  try {
    const url = new URL(value.trim());

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }

    if (!allowPrivateUrls && isPrivateHostname(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function absolutizeUrls(body: Element, baseUrl: string) {
  body.querySelectorAll("a[href], img[src]").forEach((el) => {
    for (const attr of ["href", "src"] as const) {
      const value = el.getAttribute(attr);

      if (!value || value.startsWith("data:")) {
        continue;
      }

      try {
        el.setAttribute(attr, new URL(value, baseUrl).toString());
      } catch {
        el.removeAttribute(attr);
      }
    }
  });
}
