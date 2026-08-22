// First-run demo data (PRD-adjacent, not spec'd — added so a fresh `git clone` has
// something to show immediately, not an empty sidebar). `.pact/chats/` and
// `.pact/projects/` are git-ignored (machine-specific runtime state), so the seed
// content lives in a real, git-tracked `demo-seeds/` directory at the repo root and
// gets copied in on first boot — ONLY when .pact/ has no chats at all yet, so this
// never overwrites or mixes into a real user's own work.
import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { PACT_ROOT } from './kernel/store.js';
import { listChats, getChat } from './kernel/chats.js';

export async function installDemoSeedsIfEmpty(repoRoot) {
  // A directory entry under .pact/chats/ is not the same thing as a real chat —
  // listChats() only lists directory NAMES (same as the daemon's own routes do), so an
  // orphaned/partial directory with no chat.json (e.g. left behind by an interrupted
  // process still holding a lock on one of its subfolders) must not block seeding just
  // because something happens to be sitting there. Check the same way GET /api/chats
  // does: a directory only counts if getChat() can actually read a chat.json from it.
  const ids = await listChats();
  let hasAnyChat = false;
  for (const id of ids) {
    if (await getChat(id)) {
      hasAnyChat = true;
      break;
    }
  }
  if (hasAnyChat) return { installed: false, reason: 'chats already exist' };

  const seedRoot = path.join(repoRoot, 'demo-seeds');
  if (!existsSync(seedRoot)) return { installed: false, reason: 'no demo-seeds/ directory' };

  await cp(path.join(seedRoot, 'chats'), path.join(PACT_ROOT, 'chats'), { recursive: true });
  await cp(path.join(seedRoot, 'projects'), path.join(PACT_ROOT, 'projects'), { recursive: true });
  return { installed: true };
}
