import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([
  ".mp4", ".mp3", ".wav", ".m4a", ".webm",
  ".ogg", ".flac", ".mkv", ".mov",
]);

const ALLOWED_MODELS = new Set([
  "tiny", "tiny.en",
  "base", "base.en",
  "small", "small.en",
  "medium", "medium.en",
  "large-v2", "large-v3",
]);

// ISO 639-1 (2-letter) or 639-2 (3-letter) language codes
const LANGUAGE_RE = /^[a-z]{2,3}$/;

// Python executable — override with WHISPER_PYTHON env var when faster-whisper
// is installed in a virtualenv rather than the system python3.
// e.g.  WHISPER_PYTHON=/home/arun/jiraAI/.venv/bin/python
const PYTHON_CMD = process.env["WHISPER_PYTHON"] ?? "python3";

// Job files live in the OS temp dir — no sensitive data written to the project
const JOBS_DIR = join(tmpdir(), "jira-ai-tx-jobs");

// ─── Job state types ──────────────────────────────────────────────────────────

type JobStatus = "running" | "done" | "failed";

interface JobFile {
  status: JobStatus;
  jobId: string;
  audioFile: string;
  model: string;
  startedAt: string;
  finishedAt?: string;
  transcript?: string;
  engine?: string;
  language?: string;
  error?: string;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const transcriptionToolDefinitions: Tool[] = [
  // ── Short recordings (synchronous, < ~20 min) ──────────────────────────────
  {
    name: "transcribe_meeting",
    description: [
      "Transcribe a SHORT local meeting recording (under ~20 minutes) to text using Whisper AI.",
      "For longer recordings (20 min+) use start_transcription instead to avoid timeouts.",
      "All processing is on your machine — nothing is sent externally.",
      "Prerequisite: pip install faster-whisper",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        audio_file_path: {
          type: "string",
          description: "Absolute path to the recording (.mp4, .mp3, .wav, .m4a, .webm, .mkv, .mov, .ogg, .flac).",
        },
        model: {
          type: "string",
          enum: [...ALLOWED_MODELS],
          default: "base.en",
          description: "Whisper model. tiny/base = fastest; small/medium = more accurate.",
        },
        language: {
          type: "string",
          default: "auto",
          description: "ISO 639-1 language code (e.g. 'en') or 'auto' for auto-detect.",
        },
      },
      required: ["audio_file_path"],
    },
  },

  // ── Long recordings — Step 1: start background job ─────────────────────────
  {
    name: "start_transcription",
    description: [
      "Start transcribing a long meeting recording (any duration) in the background.",
      "Returns immediately with a job_id. Use get_transcription_result to check progress.",
      "All processing is on your machine using Whisper — nothing is sent externally.",
      "Prerequisite: pip install faster-whisper",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        audio_file_path: {
          type: "string",
          description: "Absolute path to the recording (.mp4, .mp3, .wav, .m4a, .webm, .mkv, .mov, .ogg, .flac).",
        },
        model: {
          type: "string",
          enum: [...ALLOWED_MODELS],
          default: "base.en",
          description: "Whisper model. base.en is recommended for English meetings (fastest + accurate).",
        },
        language: {
          type: "string",
          default: "auto",
          description: "ISO 639-1 language code (e.g. 'en') or 'auto' for auto-detect.",
        },
      },
      required: ["audio_file_path"],
    },
  },

  // ── Long recordings — Step 2: poll for result ──────────────────────────────
  {
    name: "get_transcription_result",
    description: [
      "Check the status of a background transcription job started with start_transcription.",
      "Returns status (running/done/failed). When done, returns the full transcript.",
      "After getting the transcript, say 'Extract Jira stories from this transcript'.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "Job ID returned by start_transcription.",
        },
      },
      required: ["job_id"],
    },
  },
];

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function handleTranscriptionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "transcribe_meeting") return transcribeMeeting(args);
  if (name === "start_transcription") return startTranscription(args);
  if (name === "get_transcription_result") return getTranscriptionResult(args);
  throw new Error(`Unknown transcription tool: ${name}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateInputs(
  rawPath: string | undefined,
  model: string,
  language: string,
): string /* resolvedFilePath */ {
  if (!rawPath?.trim()) throw new Error("audio_file_path is required");

  const filePath = resolve(rawPath.trim());
  if (!existsSync(filePath)) throw new Error(`Recording not found: ${filePath}`);

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext))
    throw new Error(`Unsupported format '${ext}'. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);

  if (!ALLOWED_MODELS.has(model))
    throw new Error(`Invalid model '${model}'. Allowed: ${[...ALLOWED_MODELS].join(", ")}`);

  if (language !== "auto" && !LANGUAGE_RE.test(language))
    throw new Error(`Invalid language '${language}'. Use ISO 639-1 like 'en', 'es', or 'auto'.`);

  return filePath;
}

function jobFilePath(jobId: string): string {
  return join(JOBS_DIR, `${jobId}.json`);
}

function readJob(jobId: string): JobFile {
  // Validate jobId is a UUID to prevent path traversal
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error("Invalid job_id format");
  }
  const fp = jobFilePath(jobId);
  if (!existsSync(fp)) throw new Error(`Job not found: ${jobId}`);
  return JSON.parse(readFileSync(fp, "utf8")) as JobFile;
}

// ─── transcribe_meeting (synchronous — short recordings) ─────────────────────

async function transcribeMeeting(args: Record<string, unknown>): Promise<string> {
  const model    = (args.model    as string | undefined) ?? "base.en";
  const language = (args.language as string | undefined) ?? "auto";
  const filePath = validateInputs(args.audio_file_path as string | undefined, model, language);

  const { transcript, engine, detectedLanguage } = await runWhisperSync(filePath, model, language);

  return [
    `✅ Transcription complete — processed locally, no data left your machine`,
    `   Engine  : ${engine}`,
    `   Model   : ${model}`,
    `   Language: ${detectedLanguage}`,
    `   File    : ${filePath}`,
    ``,
    `═══ TRANSCRIPT ════════════════════════════════════════`,
    transcript,
    `════════════════════════════════════════════════════════`,
    ``,
    `💡 Say "Extract Jira stories from this transcript" to create a Jira draft.`,
  ].join("\n");
}

// ─── start_transcription (async — returns immediately) ───────────────────────

async function startTranscription(args: Record<string, unknown>): Promise<string> {
  const model    = (args.model    as string | undefined) ?? "base.en";
  const language = (args.language as string | undefined) ?? "auto";
  const filePath = validateInputs(args.audio_file_path as string | undefined, model, language);

  mkdirSync(JOBS_DIR, { recursive: true });

  const jobId   = randomUUID();
  const jobFile = jobFilePath(jobId);

  const initial: JobFile = {
    status: "running",
    jobId,
    audioFile: filePath,
    model,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(jobFile, JSON.stringify(initial), "utf8");

  // Spawn detached so the process survives even if MCP server restarts
  const child = spawn(
    PYTHON_CMD,
    ["-c", WHISPER_BG_SCRIPT, jobFile, filePath, model, language],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    },
  );
  child.unref(); // don't keep Node event loop alive waiting for this child

  return [
    `🚀 Transcription started in the background`,
    `   Job ID  : ${jobId}`,
    `   File    : ${filePath}`,
    `   Model   : ${model}`,
    `   Started : ${initial.startedAt}`,
    ``,
    `📋 Check progress with:`,
    `   get_transcription_result(job_id: "${jobId}")`,
    ``,
    `⏱  Estimated time: ${estimateMinutes(model)} minutes for a 90-min recording on CPU.`,
    `   Check back in a few minutes — poll as often as you like.`,
  ].join("\n");
}

// ─── get_transcription_result (poll) ─────────────────────────────────────────

async function getTranscriptionResult(args: Record<string, unknown>): Promise<string> {
  const jobId = (args.job_id as string | undefined)?.trim();
  if (!jobId) throw new Error("job_id is required");

  const job = readJob(jobId);
  const elapsed = Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000);

  if (job.status === "running") {
    return [
      `⏳ Transcription still running...`,
      `   Job ID  : ${jobId}`,
      `   Model   : ${job.model}`,
      `   File    : ${job.audioFile}`,
      `   Elapsed : ${formatElapsed(elapsed)}`,
      ``,
      `Poll again in a minute with get_transcription_result(job_id: "${jobId}")`,
    ].join("\n");
  }

  if (job.status === "failed") {
    return [
      `❌ Transcription failed after ${formatElapsed(elapsed)}`,
      `   Job ID : ${jobId}`,
      `   Error  : ${job.error ?? "unknown error"}`,
      ``,
      `Make sure faster-whisper is installed: pip install faster-whisper`,
    ].join("\n");
  }

  // status === "done"
  return [
    `✅ Transcription complete — processed locally, no data left your machine`,
    `   Job ID  : ${jobId}`,
    `   Engine  : ${job.engine ?? "whisper"}`,
    `   Model   : ${job.model}`,
    `   Language: ${job.language ?? "unknown"}`,
    `   Elapsed : ${formatElapsed(elapsed)}`,
    `   File    : ${job.audioFile}`,
    ``,
    `═══ TRANSCRIPT ════════════════════════════════════════`,
    job.transcript ?? "",
    `════════════════════════════════════════════════════════`,
    ``,
    `💡 Say "Extract Jira stories from this transcript" to create a Jira draft.`,
  ].join("\n");
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function estimateMinutes(model: string): string {
  const map: Record<string, string> = {
    "tiny": "5–8", "tiny.en": "5–8",
    "base": "10–18", "base.en": "10–18",
    "small": "20–35", "small.en": "20–35",
    "medium": "40–70", "medium.en": "40–70",
    "large-v2": "60–100", "large-v3": "60–100",
  };
  return map[model] ?? "varies";
}

// ─── Python scripts ───────────────────────────────────────────────────────────
//
// All user-controlled values (file paths, model name, language) are passed as
// discrete argv entries — never interpolated into the script source — so they
// cannot inject arbitrary Python code.

/** Synchronous script: prints a single JSON line to stdout. */
const WHISPER_SYNC_SCRIPT = String.raw`
import sys, json

file_path  = sys.argv[1]
model_name = sys.argv[2]
lang_arg   = sys.argv[3]
language   = None if lang_arg == "auto" else lang_arg

try:
    from faster_whisper import WhisperModel
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segs, info = model.transcribe(file_path, language=language, beam_size=5)
    transcript = " ".join(s.text.strip() for s in segs)
    print(json.dumps({"ok": True, "transcript": transcript,
                      "engine": "faster-whisper", "language": info.language}))
except ImportError:
    try:
        import whisper
        m = whisper.load_model(model_name)
        r = m.transcribe(file_path, **({"language": language} if language else {}))
        print(json.dumps({"ok": True, "transcript": r["text"].strip(),
                          "engine": "openai-whisper", "language": r.get("language", "unknown")}))
    except ImportError:
        print(json.dumps({"ok": False, "error": "Whisper not installed. Run: pip install faster-whisper"}))
        sys.exit(1)
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
    sys.exit(1)
`;

/**
 * Background script: writes job status to a JSON file atomically.
 * argv: job_file  audio_file  model  language
 */
const WHISPER_BG_SCRIPT = String.raw`
import sys, json, os, tempfile

job_file  = sys.argv[1]
file_path = sys.argv[2]
model_name = sys.argv[3]
lang_arg  = sys.argv[4]
language  = None if lang_arg == "auto" else lang_arg

def write_job(data):
    """Atomic write: write to temp file then rename to avoid partial reads."""
    dir_ = os.path.dirname(job_file)
    fd, tmp = tempfile.mkstemp(dir=dir_, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
        os.replace(tmp, job_file)
    except Exception:
        try: os.unlink(tmp)
        except Exception: pass
        raise

# Read current job metadata so we preserve startedAt / audioFile etc.
try:
    with open(job_file) as f:
        meta = json.load(f)
except Exception:
    meta = {}

try:
    from faster_whisper import WhisperModel
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segs, info = model.transcribe(file_path, language=language, beam_size=5)
    transcript = " ".join(s.text.strip() for s in segs)
    import datetime
    write_job({**meta, "status": "done", "transcript": transcript,
               "engine": "faster-whisper", "language": info.language,
               "finishedAt": datetime.datetime.utcnow().isoformat()})
except ImportError:
    try:
        import whisper, datetime
        m = whisper.load_model(model_name)
        r = m.transcribe(file_path, **({"language": language} if language else {}))
        write_job({**meta, "status": "done", "transcript": r["text"].strip(),
                   "engine": "openai-whisper", "language": r.get("language", "unknown"),
                   "finishedAt": datetime.datetime.utcnow().isoformat()})
    except ImportError:
        write_job({**meta, "status": "failed",
                   "error": "Whisper not installed. Run: pip install faster-whisper"})
except Exception as e:
    write_job({**meta, "status": "failed", "error": str(e)})
`;

// ─── Synchronous Whisper runner (used by transcribe_meeting) ─────────────────

interface WhisperResult {
  transcript: string;
  engine: string;
  detectedLanguage: string;
}

function runWhisperSync(
  filePath: string,
  model: string,
  language: string,
): Promise<WhisperResult> {
  return new Promise((res, rej) => {
    const child = spawn(
      PYTHON_CMD,
      ["-c", WHISPER_SYNC_SCRIPT, filePath, model, language],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });

    child.on("close", (code) => {
      try {
        const jsonLine = stdout.trim().split("\n").reverse().find((l) => l.startsWith("{"));
        if (!jsonLine) throw new Error("No JSON output from Python");
        const parsed = JSON.parse(jsonLine) as Record<string, unknown>;
        if (!parsed.ok) rej(new Error(`Whisper error: ${parsed.error as string}\n\nRun: pip install faster-whisper`));
        else res({
          transcript: parsed.transcript as string,
          engine: parsed.engine as string,
          detectedLanguage: parsed.language as string,
        });
      } catch {
        rej(new Error(`Transcription failed (exit ${code ?? "?"}).\nstdout: ${stdout.slice(0, 500)}\nstderr: ${stderr.slice(0, 500)}`));
      }
    });

    child.on("error", (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        rej(new Error("python3 not found in PATH. Install Python 3 then: pip install faster-whisper"));
      } else {
        rej(err);
      }
    });
  });
}

