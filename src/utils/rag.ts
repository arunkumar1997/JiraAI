/**
 * RAG (Retrieval-Augmented Generation) Utilities
 *
 * Provides document embedding via Ollama and pgvector-based
 * semantic search over chunks stored in PostgreSQL.
 */

import axios from "axios";
import { prisma } from "./database.js";
import { Config } from "../config.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  chunkId: number;
  sourceFile: string;
  content: string;
  score: number;
}

// ─── Embedding ────────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const url = `${Config.rag.ollamaUrl}/api/embeddings`;
  const response = await axios.post<{ embedding: number[] }>(
    url,
    { model: Config.rag.embeddingModel, prompt: text },
    { timeout: 30_000 },
  );
  return response.data.embedding;
}

// ─── Vector formatting ────────────────────────────────────────────────────────

/** Format a float array as a pgvector literal string, e.g. "[0.1,0.2,...]" */
export function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchDocs(
  query: string,
  topK: number = 5,
): Promise<SearchResult[]> {
  const queryVector = await embed(query);
  const literal = vectorLiteral(queryVector);

  // Use pgvector cosine distance operator (<=>)
  // Score = 1 - cosine_distance so that higher is more similar
  const rows = await prisma.$queryRaw<
    Array<{
      chunkId: number;
      sourceFile: string;
      content: string;
      score: number;
    }>
  >`
    SELECT
      c.id           AS "chunkId",
      c.source_file  AS "sourceFile",
      c.content,
      (1 - (e.embedding <=> ${literal}::vector))::float AS score
    FROM doc_chunks c
    JOIN doc_embeddings e ON e.chunk_id = c.id
    ORDER BY e.embedding <=> ${literal}::vector
    LIMIT ${topK}
  `;

  return rows;
}
