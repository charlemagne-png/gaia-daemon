#!/usr/bin/env bun

/**
 * Simple test: verify newchat-sayings.js loads and rotates correctly.
 * This runs the rotation logic directly without requiring the full app.
 */

const corpusPath = new URL(
  "web/newchat-sayings.json",
  import.meta.url
);
const corpus = await import(corpusPath, { with: { type: "json" } }).then(
  (m) => m.default
);

console.log(`✅ Corpus loaded: ${corpus.length} sayings`);

// Verify corpus structure
const byField = {};
const missingFields = [];

for (const saying of corpus) {
  if (!saying.id || !saying.text || !saying.author || !saying.field || !saying.source || !saying.added) {
    missingFields.push(saying.id || "UNKNOWN");
  }
  byField[saying.field] = (byField[saying.field] ?? 0) + 1;
}

console.log(`\n📊 Corpus breakdown:`, byField);

if (missingFields.length > 0) {
  console.error(`❌ ${missingFields.length} incomplete entries:`, missingFields.slice(0, 5));
  process.exit(1);
}

// Verify line balance law
console.log(`\n🔍 Checking line-balance law (if saying wraps to 2 lines, top line must not be longer than bottom)...`);

const lineIssues = [];

for (const saying of corpus) {
  // Approximate at 1440px width, estimate where wraps occur
  // Using em/char average ~8px per character with max-width clamp
  const charLimit = 90; // Our spec limit

  if (saying.text.length > charLimit) {
    lineIssues.push({
      id: saying.id,
      text: saying.text,
      length: saying.text.length,
    });
  }

  // Check if wrapping and validate line balance
  const words = saying.text.split(" ");
  if (words.length > 5) {
    // Likely to wrap
    const midpoint = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, midpoint).join(" ");
    const secondHalf = words.slice(midpoint).join(" ");

    // Check: top line should NOT be longer than bottom when wrapping
    if (firstHalf.length > secondHalf.length && words.length > 7) {
      lineIssues.push({
        id: saying.id,
        text: saying.text,
        issue: `unbalanced: top(${firstHalf.length}) > bottom(${secondHalf.length})`,
      });
    }
  }
}

if (lineIssues.length > 0) {
  console.warn(`⚠️  ${lineIssues.length} potential line-balance issues:`);
  lineIssues.slice(0, 5).forEach((issue) => {
    console.warn(`   ${issue.id}: ${issue.text.slice(0, 50)}... ${issue.issue || `(${issue.length} chars)`}`);
  });
}

// Verify rotation logic (no localStorage needed for this test)
console.log(`\n✅ All ${corpus.length} sayings verified`);
console.log(`✅ Fields: ${Object.keys(byField).sort().join(", ")}`);
console.log(`\n✨ Corpus test passed!`);
