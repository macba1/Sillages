// Force the new agent pipeline for Tony's account
require('dotenv/config');

async function main() {
  const { generateBrief } = await import('./dist/services/briefGenerator.js');

  const accountId = 'de866762-c1a5-4267-8f8c-fb9e927bfe21'; // Tony

  // Use yesterday's date or the latest snapshot date
  const briefDate = '2026-03-10'; // latest available snapshot

  console.log(`[run-pipeline] Forcing brief for account ${accountId}, date ${briefDate}`);

  try {
    await generateBrief({ accountId, briefDate });
    console.log('[run-pipeline] Done!');
  } catch (err) {
    console.error('[run-pipeline] Error:', err);
    process.exit(1);
  }
}

main();
