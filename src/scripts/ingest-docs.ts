#!/usr/bin/env node
/**
 * Document Ingestion CLI
 *
 * Chunks and embeds all Markdown / plain-text files from DOCS_FOLDER
 * into PostgreSQL (with pgvector) so the `search_project_docs` MCP tool
 * can retrieve them.
 *
 * Usage:
 *   DOCS_FOLDER=/path/to/your/docs npm run ingest-docs
 *
 * Options:
 *   --force   Re-index all files even if they have not changed
 *   --clear   Delete all indexed docs and exit (does NOT re-ingest)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env") });

import { Config } from "../config.js";
import { prisma } from "../utils/database.js";
import { embed, vectorLiteral } from "../utils/rag.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".markdown"]);
const MAX_CHUNK_CHARS = 500;
const MIN_CHUNK_CHARS = 50;

// ─── Chunking ─────────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length < MIN_CHUNK_CHARS) continue;

    if (trimmed.length <= MAX_CHUNK_CHARS) {
      chunks.push(trimmed);
    } else {
      const sentences = trimmed.split(/(?<=[.!?])\s+/);
      let current = "";
      for (const sentence of sentences) {
        if ((current + " " + sentence).trim().length > MAX_CHUNK_CHARS) {
          if (current.trim().length >= MIN_CHUNK_CHARS) {
            chunks.push(current.trim());
          }
          current = sentence;
        } else {
          current = current ? current + " " + sentence : sentence;
        }
      }
      if (current.trim().length >= MIN_CHUNK_CHARS) {
        chunks.push(current.trim());
      }
    }
  }

  return chunks;
}

// ─── File walking ─────────────────────────────────────────────────────────────

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else if (
      entry.isFile() &&
      SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

// ─── DB helpers (Prisma) ──────────────────────────────────────────────────────

async function deleteFileChunks(sourceFile: string): Promise<void> {
  await prisma.docChunk.deleteMany({ where: { sourceFile } });
}

async function hasExistingChunks(sourceFile: string): Promise<boolean> {
  const count = await prisma.docChunk.count({ where: { sourceFile } });
  return count > 0;
}

async function upsertChunkWithEmbedding(
  sourceFile: string,
  chunkIndex: number,
  content: string,
  vector: number[],
): Promise<void> {
  // Upsert the chunk row first
  const chunk = await prisma.docChunk.upsert({
    where: { sourceFile_chunkIndex: { sourceFile, chunkIndex } },
    create: { sourceFile, chunkIndex, content, ingestedAt: new Date() },
    update: { content, ingestedAt: new Date() },
  });

  // Insert / update the embedding using raw SQL (pgvector Unsupported type)
  const literal = vectorLiteral(vector);
  await prisma.$executeRaw`
    INSERT INTO doc_embeddings (chunk_id, embedding)
    VALUES (${chunk.id}, ${literal}::vector)
    ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding
  `;
}

// ─── Ingest a single file ─────────────────────────────────────────────────────

async function ingestFile(
  filePath: string,
  docsFolder: string,
  force: boolean,
): Promise<void> {
  const relPath = relative(docsFolder, filePath);

  if (!force && (await hasExistingChunks(relPath))) {
    console.log(
      `  [skip]  ${relPath} — already indexed (use --force to re-index)`,
    );
    return;
  }

  const text = await readFile(filePath, "utf-8");
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    console.log(`  [empty] ${relPath} — no usable chunks found`);
    return;
  }

  await deleteFileChunks(relPath);

  let embedded = 0;
  for (let i = 0; i < chunks.length; i++) {
    const vector = await embed(chunks[i]);
    await upsertChunkWithEmbedding(relPath, i, chunks[i], vector);
    embedded++;
    process.stdout.write(
      `\r  [ingest] ${relPath} -> ${embedded}/${chunks.length} chunks`,
    );
  }
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const clearOnly = args.includes("--clear");

  if (clearOnly) {
    await prisma.docChunk.deleteMany({});
    console.log("All indexed documents cleared.");
    await prisma.$disconnect();
    process.exit(0);
  }

  const docsFolder = Config.rag.docsFolder;
  if (!docsFolder) {
    console.error(
      "Error: DOCS_FOLDER environment variable is not set.\n" +
        "Usage: DOCS_FOLDER=/path/to/your/docs npm run ingest-docs",
    );
    process.exit(1);
  }

  let folderStat;
  try {
    folderStat = await stat(docsFolder);
  } catch {
    console.error(
      `Error: DOCS_FOLDER does not exist or is not accessible: ${docsFolder}`,
    );
    process.exit(1);
  }

  if (!folderStat.isDirectory()) {
    console.error(`Error: DOCS_FOLDER is not a directory: ${docsFolder}`);
    process.exit(1);
  }

  console.log(`Scanning: ${docsFolder}`);
  const files = await walkDir(docsFolder);

  if (files.length === 0) {
    console.log("No .md or .txt files found in DOCS_FOLDER.");
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(
    `Found ${files.length} file(s). Embedding model: ${Config.rag.embeddingModel}`,
  );
  console.log(`Ollama URL: ${Config.rag.ollamaUrl}\n`);

  for (const filePath of files) {
    await ingestFile(filePath, docsFolder, force);
  }

  const total = await prisma.docChunk.count();
  console.log(`\nDone. Total chunks in DB: ${total}`);
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error("Ingestion failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
