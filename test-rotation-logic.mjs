#!/usr/bin/env bun

/**
 * Test rotation logic: verify getRandomSaying() avoids immediate repeats
 * and fallback works when corpus is unavailable.
 */

// Mock localStorage for testing
const mockStorage = {};
globalThis.localStorage = {
  getItem: (key) => mockStorage[key] || null,
  setItem: (key, value) => {
    mockStorage[key] = value;
  },
};

// Import the module
const { getRandomSaying, getCorpusStats } = await import(
  "./web/src/newchat-sayings.js"
);

console.log("🧪 Testing newchat-sayings rotation logic...\n");

// Test 1: Get first saying
console.log("📝 Test 1: Get first saying");
const saying1 = await getRandomSaying();
console.log(`   Got: "${saying1.text.slice(0, 40)}..." (${saying1.id})`);
const stored1 = mockStorage["hugr.newchat.saying"];
console.log(`   Stored in localStorage: ${stored1}`);
console.log(`   ✅ Pass\n`);

// Test 2: Get second saying — should be different
console.log("📝 Test 2: Get second saying (should avoid repeat)");
const saying2 = await getRandomSaying();
console.log(`   Got: "${saying2.text.slice(0, 40)}..." (${saying2.id})`);
const stored2 = mockStorage["hugr.newchat.saying"];
console.log(`   Stored in localStorage: ${stored2}`);
if (saying2.id === saying1.id) {
  console.error(`   ❌ FAIL: Got same saying twice (${saying1.id})`);
  process.exit(1);
} else {
  console.log(`   ✅ Pass: Different saying selected\n`);
}

// Test 3: Verify stats
console.log("📝 Test 3: Verify corpus stats");
const stats = await getCorpusStats();
console.log(`   Total: ${stats.total}`);
console.log(`   Fields: ${Object.keys(stats.byField).sort().join(", ")}`);
console.log(`   Using fallback: ${stats.isFallback}`);

// In Node/Bun environment, fetch fails and uses fallback (6 quotes)
// In browser environment, will load full 80-quote corpus from JSON
if (stats.isFallback) {
  console.log(`   ✅ Pass: Fallback working correctly (Node/Bun env, fetch unavailable)`);
  if (stats.total < 6) {
    console.error(`   ❌ FAIL: Fallback should have 6 sayings, got ${stats.total}`);
    process.exit(1);
  }
} else {
  const expectedFields = ["philosophy", "physics", "math", "science", "engineering", "technology", "news", "research"];
  const fieldKeys = Object.keys(stats.byField).sort();

  if (JSON.stringify(fieldKeys) !== JSON.stringify(expectedFields)) {
    console.error(
      `   ❌ FAIL: Expected fields [${expectedFields.join(", ")}], got [${fieldKeys.join(", ")}]`
    );
    process.exit(1);
  }

  if (stats.total !== 80) {
    console.error(`   ❌ FAIL: Expected 80 sayings, got ${stats.total}`);
    process.exit(1);
  }

  console.log(`   ✅ Pass: Full corpus loaded (${stats.total} sayings)\n`);
}

console.log("🎉 All rotation tests passed!");
