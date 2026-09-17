#!/usr/bin/env bun

import { promises as fs } from "fs";
import { createHash } from "crypto";
import { execSync } from "child_process";
import path from "path";

interface FileInfo {
  path: string;
  name: string;
  size: number;
  mtime: Date;
  sha256: string;
}

interface ManifestBundle {
  name: string;
  bundleSha256: string;
  bundleSize: number;
  files: FileInfo[];
  createdAt: string;
}

interface Manifest {
  timestamp: string;
  bundles: ManifestBundle[];
  totalSourceSize: number;
  totalStagedSize: number;
  compressionRatio: number;
}

const RAW_DIR = "/Users/charleshamilton/Documents/x-feed-graph/raw";
const STAGING_DIR = "/Users/charleshamilton/.gaia/cloud/archive-staging";
const MANIFEST_PATH = path.join(STAGING_DIR, "manifest.json");

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MAX_STAGING_SIZE = 3 * 1024 * 1024 * 1024; // 3GB

async function computeSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const fileBuffer = await fs.readFile(filePath);
  hash.update(fileBuffer);
  return hash.digest("hex");
}

async function getFileStats(filePath: string): Promise<FileInfo> {
  const stat = await fs.stat(filePath);
  const name = path.basename(filePath);
  const sha256 = await computeSha256(filePath);
  return {
    path: filePath,
    name,
    size: stat.size,
    mtime: stat.mtime,
    sha256,
  };
}

function extractDateFromFilename(filename: string): string {
  // Format: 2026-08-30T20-30-11-435Z.json → 2026-08-30
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "unknown";
}

function filterEligibleFiles(files: FileInfo[]): FileInfo[] {
  const now = new Date();
  return files.filter((f) => {
    const ageMs = now.getTime() - f.mtime.getTime();
    return ageMs > FOURTEEN_DAYS_MS && ageMs > FIFTEEN_MIN_MS;
  });
}

async function checkStagingSize(currentSize: number): Promise<boolean> {
  try {
    const stats = await fs.stat(STAGING_DIR);
    if (stats.isDirectory()) {
      const { size } = await fs.stat(STAGING_DIR);
      // Rough estimate via du
      const duOutput = execSync(`du -sb "${STAGING_DIR}"`).toString();
      const actualSize = parseInt(duOutput.split("\t")[0], 10);
      return actualSize + currentSize < MAX_STAGING_SIZE;
    }
  } catch {
    return true; // Empty, safe
  }
  return true;
}

async function archiveGroup(
  date: string,
  files: FileInfo[]
): Promise<{ bundlePath: string; size: number; sha256: string } | null> {
  const bundleName = `archive-${date}.tar.zst`;
  const bundlePath = path.join(STAGING_DIR, bundleName);

  // Check if bundle already exists
  try {
    await fs.stat(bundlePath);
    console.log(`⊘ ${bundleName} 既存、skip`);
    return null;
  } catch {
    // Does not exist, proceed
  }

  // Create temp tar file
  const tempTar = path.join(STAGING_DIR, `.tmp-${date}.tar`);

  try {
    // Build tar file list
    const fileList = files.map((f) => f.path).join("\n");
    await fs.writeFile(`${STAGING_DIR}/.tmp-file-list`, fileList);

    // Create tar from file list
    execSync(
      `tar -cf "${tempTar}" --files-from="${STAGING_DIR}/.tmp-file-list" 2>/dev/null || true`
    );

    // Compress with zstd
    execSync(`zstd -19 "${tempTar}" -o "${bundlePath}" 2>/dev/null`);

    // Compute bundle hash
    const bundleHash = await computeSha256(bundlePath);
    const bundleStats = await fs.stat(bundlePath);

    // Cleanup
    await fs.unlink(tempTar);
    await fs.unlink(`${STAGING_DIR}/.tmp-file-list`);

    console.log(`✓ ${bundleName} 完成 (${(bundleStats.size / 1024 / 1024).toFixed(2)}MB)`);
    return {
      bundlePath,
      size: bundleStats.size,
      sha256: bundleHash,
    };
  } catch (e) {
    console.error(`✗ ${bundleName} 失敗：`, e);
    // Cleanup on error
    try {
      await fs.unlink(tempTar);
    } catch {}
    return null;
  }
}

async function main() {
  console.log("→ 稼動開始（nice -n 20）");
  console.log(`→ raw/: ${RAW_DIR}`);
  console.log(`→ staging: ${STAGING_DIR}`);

  // Health check before
  console.log("→ health check 前");
  try {
    const health = await fetch("http://localhost:8837/api/health");
    console.log(`  ✓ :8837 応答 (${health.status})`);
  } catch (e) {
    console.warn(`  ⊘ :8837 無応答 (許容)`);
  }

  // List raw files
  const rawFiles = await fs.readdir(RAW_DIR);
  console.log(`→ raw/ ファイル数：${rawFiles.length}`);

  // Get file stats
  const fileStats: FileInfo[] = [];
  for (const file of rawFiles) {
    if (!file.endsWith(".json")) continue;
    const fullPath = path.join(RAW_DIR, file);
    try {
      fileStats.push(await getFileStats(fullPath));
    } catch (e) {
      console.warn(`⊘ stat失敗: ${file}`);
    }
  }

  // Filter eligible
  const eligible = filterEligibleFiles(fileStats);
  console.log(`→ 対象ファイル（14日以上古い）：${eligible.length}`);

  if (eligible.length === 0) {
    console.log("→ 圧縮対象なし、終了");
    return;
  }

  // Group by date
  const grouped = new Map<string, FileInfo[]>();
  for (const file of eligible) {
    const date = extractDateFromFilename(file.name);
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(file);
  }

  console.log(`→ グループ数：${grouped.size} 日間`);

  // Archive each group
  const bundles: ManifestBundle[] = [];
  let totalSourceSize = 0;
  let totalStagedSize = 0;
  const bundleCount = grouped.size;

  for (const [date, files] of Array.from(grouped.entries()).sort()) {
    const sourceSize = files.reduce((s, f) => s + f.size, 0);
    totalSourceSize += sourceSize;

    // Check staging capacity before archiving
    if (!(await checkStagingSize(sourceSize))) {
      console.warn(
        `⊘ staging容量超過の恐れ、${date}はskip (再実行可能)`
      );
      continue;
    }

    const result = await archiveGroup(date, files);
    if (result) {
      totalStagedSize += result.size;
      bundles.push({
        name: `archive-${date}.tar.zst`,
        bundleSha256: result.sha256,
        bundleSize: result.size,
        files,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const compressionRatio =
    totalSourceSize > 0 ? totalStagedSize / totalSourceSize : 0;
  console.log(`→ 圧縮率：${(compressionRatio * 100).toFixed(2)}%`);
  console.log(`→ 束数：${bundles.length}`);

  // Write manifest
  const manifest: Manifest = {
    timestamp: new Date().toISOString(),
    bundles,
    totalSourceSize,
    totalStagedSize,
    compressionRatio,
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`✓ manifest: ${MANIFEST_PATH}`);

  // Health check after
  console.log("→ health check 後");
  try {
    const health = await fetch("http://localhost:8837/api/health");
    console.log(`  ✓ :8837 応答 (${health.status})`);
  } catch (e) {
    console.warn(`  ⊘ :8837 無応答 (許容)`);
  }

  // Summary
  console.log("\n◆ 成果");
  console.log(`束数：${bundles.length}/${bundleCount}`);
  console.log(
    `size: ${(totalSourceSize / 1024 / 1024 / 1024).toFixed(2)}GB → ${(totalStagedSize / 1024 / 1024 / 1024).toFixed(2)}GB`
  );
  console.log(`rate: ${(compressionRatio * 100).toFixed(2)}%`);
}

await main();
