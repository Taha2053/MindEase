/** Conservative minimum exclusions. Cannot identify every sensitive website. */
export function isExcludedPage(url: string, incognito = false): boolean {
  if (incognito) return true;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return true; }
  if (!["http:", "https:"].includes(parsed.protocol)) return true;
  const host = parsed.hostname.toLowerCase();
  const privateHosts = ["mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "accounts.google.com", "login.microsoftonline.com", "paypal.com", "web.whatsapp.com", "discord.com"];
  if (privateHosts.some(domain => host === domain || host.endsWith(`.${domain}`))) return true;
  if (/(^|[.-])(bank|banking|mychart|patient|healthportal)([.-]|$)/.test(host)) return true;
  return /\/(login|signin|sign-in|oauth|checkout|payment|billing|medical-records|patient)(\/|$)/i.test(parsed.pathname);
}
