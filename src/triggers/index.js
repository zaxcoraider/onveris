import { checkAllAndRecord } from '../services/drift.js';
import { recordCheckerRun } from '../storage/status.js';
import { removeStoredAccountIds } from '../storage/scrub.js';

// Leaves room inside the function's 300 second limit for the contract in progress to finish.
const BUDGET_MS = 240 * 1000;

// Runs every five minutes with no user. Contracts not reached in one run are first in the next.
export async function scheduledCheck() {
  // One-off clean-up of data saved by earlier versions; it must never stop the check.
  try {
    await removeStoredAccountIds();
  } catch (error) {
    console.warn(`[scrub] ${error.message}`);
  }
  const summary = await checkAllAndRecord({ budgetMs: BUDGET_MS });
  await recordCheckerRun(summary);
  if (summary.checked + summary.failed + summary.skipped > 0) console.log('[checker]', JSON.stringify(summary));
}
