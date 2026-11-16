import api, { route } from '@forge/api';
import { RegistryError } from './registry.js';

// Confluence reads, always as the current user, so nobody is shown a page they cannot view.

const PAGE_ID = /^\d{1,19}$/;
const MAX_PAGES_PER_READ = 250;

// Confluence short links (".../wiki/x/MgFK") carry the page id as base64 of its bytes, least
// significant byte first, with "-" for "/", "_" for "+", and trailing zero characters ("A")
// and padding dropped. Returns the id as a string, or null when it is not a short link code.
export function decodeTinyLink(code) {
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(code)) return null;
  let b64 = code.replace(/-/g, '/').replace(/_/g, '+');
  while (b64.length % 4) b64 += 'A';
  const bytes = Buffer.from(b64, 'base64');
  let id = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) id = (id << 8n) + BigInt(bytes[i]);
  return id > 0n ? id.toString() : null;
}

// Pulls a page id out of what a person typed or pasted: a page link (".../pages/123/Title"),
// an old-style link ("viewpage.action?pageId=123"), a short link (".../wiki/x/MgFK") or the
// bare id. Returns the id as a string, or null.
export function extractPageId(input) {
  const raw = String(input ?? '').trim();
  if (PAGE_ID.test(raw)) return raw;
  const fromPath = raw.match(/\/pages\/(?:edit-v2\/|edit\/)?(\d{1,19})(?:[/?#]|$)/);
  if (fromPath) return fromPath[1];
  const fromQuery = raw.match(/[?&]pageId=(\d{1,19})(?:[&#]|$)/);
  if (fromQuery) return fromQuery[1];
  const tiny = raw.match(/\/x\/([A-Za-z0-9_-]+)(?:[/?#]|$)/);
  if (tiny) return decodeTinyLink(tiny[1]);
  return null;
}

const describe = (page, base) => ({
  id: String(page.id),
  title: page.title || 'Untitled page',
  url: page._links?.webui ? `${base || '/wiki'}${page._links.webui}` : null,
});

// Looks up pages by id. Ones that do not exist or the user cannot view are left out and only
// counted: Confluence answers both cases the same way, and so do we.
export async function findVisiblePages(ids) {
  const wanted = [...new Set(ids.map(String))].filter((id) => PAGE_ID.test(id));
  const pages = [];
  for (let i = 0; i < wanted.length; i += MAX_PAGES_PER_READ) {
    const batch = wanted.slice(i, i + MAX_PAGES_PER_READ);
    const response = await api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/pages?id=${batch.join(',')}&limit=${batch.length}`, {
        headers: { Accept: 'application/json' },
      });
    // Onveris is installed in Jira first; Confluence answers like this until it is connected there too.
    if ([401, 403, 404].includes(response.status)) {
      throw new RegistryError("Couldn't read Confluence. Check that Onveris is connected to Confluence on this site.");
    }
    if (!response.ok) throw new Error(`Confluence answered ${response.status} reading pages`);
    const data = await response.json();
    pages.push(...(data.results || []).map((page) => describe(page, data._links?.base)));
  }
  // Keep the order the pages were linked in.
  const byId = new Map(pages.map((page) => [page.id, page]));
  const visible = wanted.map((id) => byId.get(id)).filter(Boolean);
  return { pages: visible, hidden: ids.length - visible.length };
}

export async function findPage(id) {
  const { pages } = await findVisiblePages([id]);
  return pages[0] || null;
}
