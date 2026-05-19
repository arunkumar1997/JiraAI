/**
 * Project Docs Tools
 *
 * MCP tool for semantic search over ingested project documents.
 * Use `npm run ingest-docs` to index documents before calling this tool.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { searchDocs } from "../utils/rag.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const docsToolDefinitions: Tool[] = [
  {
    name: "search_project_docs",
    description:
      "Semantically search the project's documentation for relevant context. " +
      "Call this BEFORE creating JIRA issues to pull in domain-specific requirements, " +
      "architecture constraints, terminology, and acceptance criteria already defined in " +
      "the project docs. Returns the most relevant passages with their source filenames.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language query describing what you need from the project docs " +
            "(e.g. 'authentication requirements', 'data retention policy', 'API rate limits').",
        },
        top_k: {
          type: "number",
          description: "Number of results to return (1–10). Defaults to 5.",
        },
      },
      required: ["query"],
    },
  },
];

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleDocsTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name !== "search_project_docs") {
    throw new Error(`Unknown docs tool: ${name}`);
  }

  const query = args.query as string;
  const topK = Math.min(Math.max(Number(args.top_k ?? 5), 1), 10);

  if (!query?.trim()) {
    throw new Error("query is required and must be a non-empty string.");
  }

  let results;
  try {
    results = await searchDocs(query, topK);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
      throw new Error(
        `Cannot reach Ollama at the configured URL. ` +
          `Ensure Ollama is running and OLLAMA_URL is correct. Details: ${msg}`,
      );
    }
    throw err;
  }

  if (results.length === 0) {
    return (
      "No project documents are indexed yet.\n\n" +
      "Run `npm run ingest-docs` with DOCS_FOLDER set to your documents directory to index them first."
    );
  }

  const lines: string[] = [
    `## Project Docs — Top ${results.length} results for: "${query}"\n`,
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const score = (r.score * 100).toFixed(1);
    lines.push(`### ${i + 1}. ${r.sourceFile}  (relevance: ${score}%)\n`);
    lines.push(r.content.trim());
    lines.push("");
  }

  return lines.join("\n");
}
