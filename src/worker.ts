// Reads every agent through `orca worktree ps --json`, the same rows Orca's sidebar and phone app
// draw from. The plugin API's agents.list only covers the focused workspace, so the worker asks
// the CLI instead and trims the answer to what the office draws. One call covers this machine and
// its SSH targets; each paired Orca server (a cloud VM) answers only its own `--environment` call.
import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import type { Desk, Floor, OfficeSnapshot, Specialist, Staff, StaffState, SwitchOutcome } from './protocol'

const CLI_TIMEOUT_MS = 8000
// a paired server gets less, so this machine's call plus the slowest server's stay under the
// panel's 15 s wait for a snapshot
const SERVER_TIMEOUT_MS = 5000

export type CliLookupEnv = {
  platform?: string
  env?: Record<string, string | undefined>
  resourcesPath?: string | null
  exists?: (path: string) => boolean
}

export type CliTarget = {
  command: string
  shell: boolean
  fallbackCommand?: string
}

const isBatchFile = (command: string): boolean => /\.(?:cmd|bat)$/i.test(command)

export function cliCandidates(options: CliLookupEnv = {}): string[] {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const resourcesPath =
    options.resourcesPath !== undefined
      ? options.resourcesPath
      : ((process as { resourcesPath?: string }).resourcesPath ?? null)
  const candidates: string[] = []
  const push = (p: string | null | undefined) => {
    const trimmed = p?.trim()
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed)
  }

  push(env.ORCA_CLI_COMMAND)
  if (env.ORCA_CLI_BIN_DIR?.trim()) {
    const binDir = env.ORCA_CLI_BIN_DIR.trim().replace(/[\\/]+$/, '')
    push(platform === 'win32' ? `${binDir}\\orca.exe` : `${binDir}/orca`)
  }

  if (resourcesPath) {
    if (platform === 'win32') {
      push(`${resourcesPath}\\bin\\orca.exe`)
      push(`${resourcesPath}\\bin\\orca.cmd`)
    } else if (platform === 'linux') {
      push(`${resourcesPath}/bin/orca-ide`)
      push(`${resourcesPath}/bin/orca`)
    } else {
      push(`${resourcesPath}/bin/orca`)
    }
  }

  if (platform === 'win32') {
    const roots = [
      env.LOCALAPPDATA,
      env.USERPROFILE ? `${env.USERPROFILE}\\AppData\\Local` : undefined,
      env.PROGRAMFILES,
      env['PROGRAMFILES(X86)']
    ]
    for (const root of roots) {
      if (!root?.trim()) continue
      const base = root.trim().replace(/[\\/]+$/, '')
      push(`${base}\\Programs\\Orca\\resources\\bin\\orca.exe`)
      push(`${base}\\Programs\\orca\\resources\\bin\\orca.exe`)
      push(`${base}\\Orca\\resources\\bin\\orca.exe`)
      push(`${base}\\Programs\\Orca\\resources\\bin\\orca.cmd`)
      push(`${base}\\orca\\bin\\orca.cmd`)
    }
  } else if (platform === 'linux') {
    // On Linux desktop, Orca installs its CLI as `orca-ide` because `/usr/bin/orca` is the GNOME screen reader.
    if (env.HOME?.trim()) {
      const home = env.HOME.trim().replace(/\/+$/, '')
      push(`${home}/.config/orca/linux-orca-cli-shim/orca`)
      push(`${home}/.local/bin/orca-ide`)
    }
    push('/usr/local/bin/orca-ide')
    push('/usr/bin/orca-ide')
    push('/opt/Orca/resources/bin/orca-ide')
    push('/usr/local/bin/orca')
  } else {
    push('/Applications/Orca.app/Contents/Resources/bin/orca')
    if (env.HOME?.trim()) {
      push(`${env.HOME.trim().replace(/\/+$/, '')}/Applications/Orca.app/Contents/Resources/bin/orca`)
    }
  }

  return candidates
}

export function resolveCliTarget(options: CliLookupEnv = {}): CliTarget {
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? existsSync
  const found = cliCandidates(options).find((p) => exists(p))
  if (found) {
    return { command: found, shell: platform === 'win32' && isBatchFile(found) }
  }
  if (platform === 'win32') {
    return { command: 'orca.exe', shell: false, fallbackCommand: 'orca.cmd' }
  }
  if (platform === 'linux') {
    return { command: 'orca-ide', shell: false, fallbackCommand: 'orca' }
  }
  return { command: 'orca', shell: false }
}

function execCliFile(command: string, args: string[], timeout: number, shell: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 32 * 1024 * 1024, shell }, (error, stdout) => {
      if (error && !stdout) return reject(error)
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch (parseError) {
        return reject(error ?? parseError)
      }
      // `--json` answers carry ok and, when refused, error.code / error.message
      const answer = parsed as { ok?: unknown; error?: { message?: unknown; code?: unknown } } | null
      if (answer?.ok === false) {
        return reject(new Error(str(answer.error?.message) ?? str(answer.error?.code) ?? 'the Orca CLI refused'))
      }
      resolve(parsed)
    })
  })
}

/** Runs the CLI with an argument array and parses its JSON answer. */
async function runCli(args: string[], timeout = CLI_TIMEOUT_MS): Promise<unknown> {
  const target = resolveCliTarget()
  try {
    return await execCliFile(target.command, args, timeout, target.shell)
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (target.fallbackCommand && (code === 'ENOENT' || code === 'EINVAL')) {
      return execCliFile(target.fallbackCommand, args, timeout, isBatchFile(target.fallbackCommand))
    }
    throw error
  }
}

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** One paired Orca server's `worktree ps` answer, with the selector that reached it. */
export type ServerAnswer = { environment: string; raw: unknown }

const RUNTIME_HOST = 'runtime:'

/**
 * The paired servers a local `worktree ps` names as not covered, by environment id. Orca's own
 * selector uses the server's name, which two servers can share; the id always resolves to one.
 */
export function pairedEnvironments(raw: unknown): string[] {
  const scope = (raw as { result?: { hostScope?: { omittedHostIds?: unknown } } } | null)?.result?.hostScope
  const hostIds = Array.isArray(scope?.omittedHostIds) ? scope.omittedHostIds : []
  const ids = hostIds
    .map((h) => str(h))
    .filter((h): h is string => !!h && h.startsWith(RUNTIME_HOST))
    .map((h) => {
      try {
        return decodeURIComponent(h.slice(RUNTIME_HOST.length)).trim()
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  return [...new Set(ids)]
}

/**
 * This machine's answer, then every paired server's in parallel. A server that is down or slow
 * costs only its own desks: `onServerError` hears about it and the rest of the office still draws.
 */
export async function readAllHosts(
  run: (args: string[], timeout?: number) => Promise<unknown>,
  onServerError: (environment: string, error: unknown) => void = () => {}
): Promise<{ local: unknown; servers: ServerAnswer[] }> {
  const local = await run(['worktree', 'ps', '--agent-wait', '--json'])
  const answers = await Promise.all(
    pairedEnvironments(local).map(async (environment) => {
      try {
        return { environment, raw: await run(['worktree', 'ps', '--agent-wait', '--json', '--environment', environment], SERVER_TIMEOUT_MS) }
      } catch (error) {
        onServerError(environment, error)
        return null
      }
    })
  )
  return { local, servers: answers.filter((a): a is ServerAnswer => a !== null) }
}

const NEED_YOU_LINE =
  /^(?:necesito\s*:|necesito\s+(?:tu|su)\s+(?:confirmaci[oó]n|aprobaci[oó]n|decisi[oó]n|visto\s+bueno|autorizaci[oó]n|s[ií]|ok|okay|respuesta|indicaci[oó]n)\b|necesito\s+que\s+(?:confirmes|decidas|apruebes|autorices|indiques|elijas|me\s+digas|llenes|pases|compartas|definas|revises)\b|(?:espero|esperando)\s+(?:tu|su)\s+(?:confirmaci[oó]n|aprobaci[oó]n|decisi[oó]n|visto\s+bueno|autorizaci[oó]n|respuesta|indicaci[oó]n)\b|(?:need|needed|need\s+from\s+you|what\s+i\s+need|decision\s+needed|input\s+needed|action\s+needed|waiting\s+on\s+you)\s*:|(?:i\s+)?need\s+your\s+(?:confirmation|approval|decision|input|go-ahead|sign-off|ok|okay|permission|direction|ruling|answer|reply|response)\b|(?:waiting|awaiting)\s+(?:for|on)\s+your\s+(?:confirmation|approval|decision|input|go-ahead|sign-off|ok|okay|permission|direction|ruling|answer|reply|response)\b|please\s+(?:confirm|decide|approve|open\s+the\s+plan|let\s+me\s+know\s+whether)\b)/i
const PIPELINE_WAIT_LINE =
  /\b(?:el\s+pipeline\s+se\s+detuvo\s+y\s+pide\s+una\s+decisi[oó]n|pide\s+una\s+decisi[oó]n\s+tuya|a\s+human\s+decides\s+the\s+next\s+step|waiting_for_person|reply\s+to\s+it\s+now\s+counts\s+as\s+the\s+approval|open\s+the\s+plan\s+file\s+and\s+approve\s+it|tu\s+respuesta\s+ahora\s+cuenta\s+como\s+la\s+aprobaci[oó]n)\b/i

function cleanReplyLine(line: string): string {
  return line
    .replace(/^(?:[-*>•]+\s*)+/, '')
    .replace(/\*\*|__/g, '')
    .trim()
}

export type RunStopWait = {
  subject: string | null
  reasonText: string | null
  transcriptTail: string
  tabId?: string | null
}

const TAIL_BYTES = 32 * 1024

function readTail(filePath: string): string {
  let fd: number | null = null
  try {
    fd = openSync(filePath, 'r')
    const size = fstatSync(fd).size
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, Math.max(0, size - length))
    return buffer.toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // ignore close errors
      }
    }
  }
}

/**
 * Reads `~/.stratos/run-stops/*.json` (for `🙋 te necesita`) and
 * `~/.stratos/portfolio/fleet-pane-cache/v2/docs/*.json` (for orchestrate `Needs you: N`)
 * and returns active records currently waiting on the human operator.
 */
export function readWaitingRunStops(): RunStopWait[] {
  const root = process.env.STRATOS_STORE_ROOT ?? process.env.HOME ?? ''
  if (!root) return []
  const out: RunStopWait[] = []

  const dir = join(root, '.stratos', 'run-stops')
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    files = []
  }
  const latestBySession = new Map<string, Row>()
  for (const file of files) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Row
      const sid = str(rec.owner_session_id)
      if (!sid) continue
      const prev = latestBySession.get(sid)
      const prevAt = str(prev?.updated_at) ?? ''
      const curAt = str(rec.updated_at) ?? ''
      if (!prev || curAt >= prevAt) latestBySession.set(sid, rec)
    } catch {
      // ignore unreadable record
    }
  }
  for (const rec of latestBySession.values()) {
    if (rec.state !== 'stopped' || rec.stop_reason !== 'waiting_for_person') continue
    const transcriptPath = str(rec.owner_transcript_path)
    const transcriptTail = transcriptPath ? readTail(transcriptPath) : ''
    out.push({
      subject: str(rec.subject),
      reasonText: str(rec.reason_text),
      transcriptTail
    })
  }

  const fleetDir = join(root, '.stratos', 'portfolio', 'fleet-pane-cache', 'v2', 'docs')
  let fleetFiles: string[] = []
  try {
    fleetFiles = readdirSync(fleetDir).filter((f) => f.endsWith('.json'))
  } catch {
    fleetFiles = []
  }
  for (const file of fleetFiles) {
    try {
      const doc = JSON.parse(readFileSync(join(fleetDir, file), 'utf8')) as Row
      const scope = doc.scope as Row | undefined
      if (scope?.state !== 'bound') continue
      const tabId = str(scope.tab_id)
      if (!tabId) continue
      const runs = Array.isArray(doc.runs) ? (doc.runs as Row[]) : []
      const liveRunIds = new Set(
        runs.filter((r) => r.execution !== 'ended').map((r) => str(r.run_id)).filter((id): id is string => Boolean(id))
      )
      if (liveRunIds.size === 0) continue
      const needsYou = doc.needs_you as Row | undefined
      const items = Array.isArray(needsYou?.items) ? (needsYou.items as Row[]) : []
      const humanItem = items.find((item) => item.owner === 'human' && liveRunIds.has(str(item.run_id) ?? ''))
      if (!humanItem) continue
      const action = str(humanItem.action)
      out.push({
        subject: null,
        reasonText: action ? `Needs you: ${action}` : 'Needs your decision on the plan',
        transcriptTail: '',
        tabId
      })
    } catch {
      // ignore unreadable fleet doc
    }
  }

  return out
}

function matchRunStop(row: Row, runStops: readonly RunStopWait[]): RunStopWait | null {
  if (runStops.length === 0) return null
  const paneKey = str(row.paneKey) ?? ''
  const rowTabId = paneKey.split(':')[0] ?? ''
  if (rowTabId) {
    for (const stop of runStops) {
      if (stop.tabId && stop.tabId === rowTabId) return stop
    }
  }
  const msg = str(row.lastAssistantMessage)
  const firstLine = msg?.split('\n')[0]?.trim() ?? ''
  const probe = firstLine.slice(0, 60)
  for (const stop of runStops) {
    if (probe.length >= 20 && stop.transcriptTail && stop.transcriptTail.includes(probe)) {
      return stop
    }
  }
  return null
}

/**
 * Extracts the prompt when a finished turn asks the user for a decision in prose
 * (an explicit Spanish/English decision line like `necesito: ...` or `need: ...`,
 * a pipeline pause notice, or a session matched in `~/.stratos/run-stops` or `fleet-pane-cache`).
 */
export function waitingReplyPrompt(row: Row, runStops: readonly RunStopWait[] = []): string | null {
  const matchedStop = matchRunStop(row, runStops)
  const msg = str(row.lastAssistantMessage)
  const lines = msg ? msg.split('\n').map(cleanReplyLine).filter(Boolean) : []

  for (let i = lines.length - 1; i >= 0; i--) {
    if (NEED_YOU_LINE.test(lines[i])) return lines[i].slice(0, 120)
  }
  if (matchedStop?.reasonText) return matchedStop.reasonText.slice(0, 120)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (PIPELINE_WAIT_LINE.test(lines[i])) return lines[i].slice(0, 120)
  }
  if (/\bannounce-finalize\b/.test(str(row.toolInput) ?? '')) {
    return 'Plan presented — waiting for your approval or changes'
  }
  if (matchedStop) return 'Pipeline waiting for your decision'
  return null
}

export function staffState(row: Row, runStops: readonly RunStopWait[] = []): StaffState {
  if (row.agentWait != null && (typeof row.agentWait !== 'object' || Object.keys(row.agentWait).length > 0)) {
    return 'waiting'
  }
  const state = row.state
  if (state === 'working') {
    const mainDone = (row.mainAgent as Row | null)?.state === 'done'
    const progState =
      row.programStatus && typeof row.programStatus === 'object' ? (row.programStatus as Row).state : undefined
    if (row.workingMode === 'monitoring') {
      if ((mainDone || progState === 'done') && matchRunStop(row, runStops)) return 'waiting'
      return 'monitoring'
    }
    if (progState && progState !== 'working') {
      if (progState === 'done' && waitingReplyPrompt(row, runStops)) return 'waiting'
      return progState === 'done' ? 'done' : 'idle'
    }
    return 'working'
  }
  if (state === 'waiting' || state === 'blocked') return state
  if (state === 'done') return waitingReplyPrompt(row, runStops) ? 'waiting' : 'done'
  return 'idle'
}

function specialistState(state: unknown): StaffState {
  if (
    state === 'working' ||
    state === 'monitoring' ||
    state === 'waiting' ||
    state === 'blocked' ||
    state === 'done'
  ) {
    return state
  }
  return 'idle'
}

// Chat UI sessions report their helpers as `children`, which Orca treats as the canonical list
// over the older `subagents` roster, even when it is empty. Only agents and workflows are
// specialists; commands and shells stay off the floor, and settled children have gone home.
const SPECIALIST_KINDS = new Set(['agent', 'workflow'])

function specialistsOf(row: Row): Specialist[] {
  if (Array.isArray(row.children)) {
    return (row.children as Row[])
      .filter((c) => SPECIALIST_KINDS.has(String(c.kind)) && c.membership !== 'settled')
      .map((c) => ({
        id: String(c.providerId ?? c.id ?? ''),
        role: str(c.agentType) ?? str(c.name),
        task: str(c.description),
        state: specialistState(c.state)
      }))
  }
  const subs = Array.isArray(row.subagents) ? (row.subagents as Row[]) : []
  return subs.map((s) => ({
    id: String(s.id ?? ''),
    role: str(s.agentType),
    task: str(s.description),
    state: specialistState(s.state)
  }))
}

// ---- what an agent says when you click it -----------------------------------------------------
// A short first-person line from the state, the tool and its input, which Orca already sends as a
// preview (a file path, a command, a search, a URL). Rules rather than a model: it costs nothing,
// it is never stale and nothing leaves the machine.

const base = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path
const clip = (text: string, max = 24): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The command that does the work, past `cd x &&`, env assignments and wrappers. */
function mainCommand(command: string): string {
  const parts = command.split(/\s*(?:&&|\|\||;|\n)\s*/).map((p) => p.trim()).filter(Boolean)
  const strip = (p: string) =>
    p
      .replace(/^&\s+/, '')
      .replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '')
      .replace(/^(?:sudo|time|timeout\s+\S+|npx|bunx|exec)\s+/, '')
  const real = parts.map(strip).filter((p) => !/^(?:cd|export|set|source|\.|echo|true|O=|mkdir)\b/.test(p))
  const selected = real[0] ?? strip(parts[0] ?? '')
  // /Applications/Orca.app/.../bin/orca and C:\...\bin\orca.exe read as orca / orca.exe
  return selected
    .replace(/^"([^"]*[/\\])([^"/\\]+)"/, '$2')
    .replace(/^'([^']*[/\\])([^'/\\]+)'/, '$2')
    .replace(/^\S*[/\\]/, '')
}

const COMMAND_LINES: [RegExp, string][] = [
  [/^gh\s+pr\s+(?:checks|status)\b/, "I'm checking the PR's checks"],
  [/^gh\s+pr\s+create\b/, "I'm opening a PR"],
  [/^gh\s+pr\s+merge\b/, "I'm merging the PR"],
  [/^gh\s+pr\s+(?:comment|review)\b/, "I'm replying on the PR"],
  [/^gh\s+pr\b/, "I'm looking at the PR"],
  [/^gh\s+run\s+watch\b/, "I'm watching CI run"],
  [/^gh\s+run\b/, "I'm checking CI"],
  [/^gh\s+issue\b/, "I'm reading an issue"],
  [/^gh\s+release\b/, "I'm cutting a release"],
  [/^gh\b/, "I'm asking GitHub"],
  [/^git\s+push\b/, "I'm pushing my branch"],
  [/^git\s+commit\b/, "I'm committing"],
  [/^git\s+(?:rebase|merge|pull|fetch)\b/, "I'm catching up with main"],
  [/^git\s+(?:checkout|switch|branch|worktree)\b/, "I'm switching branches"],
  [/^git\s+tag\b/, "I'm tagging a release"],
  [/^git\b/, "I'm looking at the changes"],
  [/\b(?:vitest|jest|pytest|playwright|mocha)\b|\b(?:cargo|go|deno|bun)\s+test\b|\btest\b/, "I'm running the tests"],
  [/\b(?:tsc|eslint|biome|lint|type-?check|typecheck|prettier|ruff|mypy|clippy|verify)\b/, "I'm running the checks"],
  [/\b(?:npm|pnpm|yarn|bun|pip|uv|brew|cargo)\s+(?:i|install|add)\b/, "I'm installing packages"],
  [/\bbuild\b/, "I'm building it"],
  [/\b(?:dev|serve|start|http\.server)\b/, "I'm starting a server"],
  [/^(?:curl|wget|http)\b/, "I'm fetching a page"],
  [/^sleep\b/, "I'm giving it a moment"],
  [/^(?:psql|supabase|sqlite3|mysql|prisma)\b/, "I'm checking the database"],
  [/^(?:docker|kubectl|terraform|tofu|vercel|fly|render)\b/, "I'm working on the infra"],
  [/^orca(?:-ide)?(?:\.(?:exe|cmd))?\b/i, "I'm talking to Orca"],
  [/^(?:rg|grep|find|fd|ls|tree|cat|head|tail|sed|awk|wc|jq|less)\b/, "I'm looking through the code"],
  [/^(?:rm|mv|cp|chmod|ln)\b/, "I'm tidying files"],
  [/^(?:python3?|node|ruby|bash|sh|zsh|deno|bun|tsx)\b/, "I'm running a script"],
  [/^(?:pkill|kill)\b/, "I'm stopping a process"]
]

function commandLine(command: string): string {
  const cmd = mainCommand(command)
  for (const [pattern, line] of COMMAND_LINES) if (pattern.test(cmd)) return line
  const name = cmd.split(/\s+/)[0]
  return name ? `I'm running ${clip(base(name), 14)}` : "I'm running a command"
}

const READ_TOOLS = /^(?:read|view|view_file|read_file|read_many_files|NotebookRead)$/i
const EDIT_TOOLS = /^(?:edit|multiedit|notebookedit|edit_file|replace|search_replace|apply_patch|patch|replace_file_content|multi_replace_file_content)$/i
const WRITE_TOOLS = /^(?:write|create|write_file|write_to_file)$/i
const SHELL_TOOLS = /^(?:bash|execute|run_shell_command|run_command|exec_command|shell_command|run_terminal_cmd|run_terminal_command|terminal|powershell|shell|execute_code)$/i
const SEARCH_TOOLS = /^(?:grep|glob|search_file_content|grep_search|find_by_name|search_files|list_dir|ls|toolsearch)$/i

function toolLine(tool: string, input: string | null): string {
  if (SHELL_TOOLS.test(tool)) return input ? commandLine(input) : "I'm running a command"
  if (READ_TOOLS.test(tool)) return input ? `I'm reading ${clip(base(input))}` : "I'm reading the code"
  if (EDIT_TOOLS.test(tool)) return input ? `I'm editing ${clip(base(input))}` : "I'm editing the code"
  if (WRITE_TOOLS.test(tool)) return input ? `I'm writing ${clip(base(input))}` : "I'm writing a file"
  if (SEARCH_TOOLS.test(tool)) return "I'm searching the code"
  if (/^(?:webfetch|fetchurl|web_fetch|fetch_content|read_url_content|browser_navigate|open_page)$/i.test(tool)) {
    const host = input?.match(/^[a-z]+:\/\/(?:www\.)?([^/:?#]+)/i)?.[1]
    return host ? `I'm reading ${clip(host)}` : "I'm reading a web page"
  }
  if (/search/i.test(tool) && /web|google/i.test(tool)) return input ? `I'm looking up ${clip(input, 18)}` : "I'm looking something up"
  if (/^(?:agent|task|spawn_subagent|delegate_task)$/i.test(tool)) return "I'm briefing a specialist"
  if (/^workflow$/i.test(tool)) return "I'm running a workflow"
  if (/^(?:todowrite|todo_write|update_plan|manage_task|exitplanmode|enterplanmode)$/i.test(tool)) return "I'm planning the next steps"
  if (/^skill$/i.test(tool)) return "I'm reading up on a skill"
  if (/^(?:monitor|schedulewakeup|taskoutput|bashoutput)$/i.test(tool)) return "I'm keeping an eye on a job"
  if (/^browser_|^mcp__claude-in-chrome__/i.test(tool)) return "I'm clicking through a page"
  // mcp__<server>__<tool>: claude_ai_Linear is Linear, plugin_figma_figma is figma
  const server = tool.match(/^mcp__(.+?)__/)?.[1].replace(/^claude_ai_/, '').replace(/^plugin_.*_/, '')
  if (server) return `I'm using ${clip(server.replace(/_/g, ' '), 16)}`
  return "I'm working on it"
}

const LEADER_NAME_PATTERNS = [
  /\borch:\d+.*?\blead\b/i,
  /\b(?:team[- ]?lead|tech[- ]?lead|lead[- ]?agent|coordinator|coordinador|orchestrator|supervisor)\b/i,
  /(?:^|[:\-\/|•·])\s*lead\s+[^a-z]*(?:[A-Z0-9]|$)/i
]

const LEADER_PROMPT_PATTERNS = [
  /\borca\s+orchestration\b/i,
  /\borchestration\s+check\b/i,
  /^\s*\/orchestrate\b/i
]

/** True when an agent is leading or coordinating an orchestration / multi-agent run. */
export function isLeaderStaff(row: Row, deskName: string): boolean {
  const name = str(row.conversationName) ?? str(row.displayName) ?? str(row.taskTitle) ?? ''
  const title = str(row.taskTitle) ?? ''
  const activityTitle = str((row.activity as Row | null)?.title) ?? ''
  const prompt = str(row.prompt) ?? ''

  if (LEADER_NAME_PATTERNS.some((p) => p.test(name) || p.test(title) || p.test(activityTitle) || p.test(deskName))) {
    return true
  }

  if (LEADER_PROMPT_PATTERNS.some((p) => p.test(prompt))) {
    return true
  }

  return false
}

/** The one line an agent says when you click it. */
export function lineOf(
  row: Row,
  state: StaffState,
  specialists: Specialist[],
  isLeader = false,
  runStops: readonly RunStopWait[] = []
): string {
  const busy = specialists.filter((s) => s.state !== 'done' && s.state !== 'idle')
  if (state === 'waiting') {
    const prompt =
      str(row.agentWaitPrompt) ??
      str((row.agentWait as Row)?.prompt) ??
      str((row.agentWait as Row)?.message) ??
      waitingReplyPrompt(row, runStops)
    if (prompt) return prompt
    return /ask/i.test(String(row.toolName ?? '')) ? 'I have a question for you' : 'I need your input'
  }
  if (state === 'blocked') return "I'm stuck, can you help?"
  if (state === 'done') return str(row.lastAssistantMessage)?.split('\n')[0]?.slice(0, 120) ?? 'All done!'
  if (state === 'idle') {
    return isLeader ? "I'm coordinating: standing by for workers" : "I'm free"
  }
  const tool = str(row.toolName)
  // a specialist's turn: the agent is monitoring, or sits on the Agent call that launched it
  const handedOff = state === 'monitoring' || !tool || /^(?:agent|task)$/i.test(tool)
  if (isLeader) {
    if (handedOff && busy.length === 1) return `I'm coordinating: waiting on the ${clip(busy[0].role ?? 'specialist', 18)}`
    if (handedOff && busy.length > 1) return `I'm coordinating: waiting on ${busy.length} specialists`
    if (state === 'monitoring') return "I'm coordinating: waiting on workers and CI"
    if (tool && /^(?:bash|run_command|shell)$/i.test(tool) && /orchestration/i.test(str(row.toolInput) ?? '')) {
      return "I'm coordinating: checking on workers"
    }
  }
  if (handedOff && busy.length === 1) return `I'm waiting on the ${clip(busy[0].role ?? 'specialist', 18)}`
  if (handedOff && busy.length > 1) return `I'm waiting on ${busy.length} specialists`
  if (state === 'monitoring') return "I'm waiting on a background job"
  return tool ? toolLine(tool, str(row.toolInput)) : (isLeader ? "I'm coordinating" : "I'm thinking")
}

// ---- the nameplate on a desk --------------------------------------------------------------------
// A ticket key or issue number wins wherever it appears. Otherwise a workspace with a name of its
// own keeps it, and only a generic one (the main checkout, `main`, or a name several desks in the
// project share) borrows the first word of the agent's conversation title instead.

const TICKET_KEY = /\b[A-Z]{2,6}-\d+\b/
const ISSUE_NUMBER = /#(\d+)\b/
const LEADING_SYMBOLS = /^[^\p{L}\p{N}]+/u
const TRAILING_SYMBOLS = /[^\p{L}\p{N}]+$/u

/** The first word of a title, without the symbols around it; empty when there is none. */
function firstWord(title: string): string {
  const word = title.replace(LEADING_SYMBOLS, '').split(/[\s/]+/)[0] ?? ''
  return word.replace(TRAILING_SYMBOLS, '')
}

const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'trunk'])

/** True when a workspace name says nothing about the work: a default branch name. */
export function isGenericName(deskName: string, defaultBranch: string | null = null): boolean {
  const name = deskName.trim().toLowerCase()
  return DEFAULT_BRANCHES.has(name) || (defaultBranch !== null && name === defaultBranch.toLowerCase())
}

/** A workspace's own short name: its first word, and for a branch path its last segment. */
function ownName(deskName: string): string {
  return deskName.trim().split(/\s+/)[0].split('/').filter(Boolean).pop() ?? ''
}

/**
 * What the nameplate reads for an agent whose conversation is `name`, at the desk `deskName`.
 * `generic` says the desk's own name tells it apart from nothing, so the title gets a turn.
 */
export function labelOf(name: string | null, deskName: string, generic = isGenericName(deskName)): string {
  const title = name ?? ''
  const ticket = title.match(TICKET_KEY) ?? deskName.match(TICKET_KEY)
  if (ticket) return ticket[0]
  const issue = title.match(ISSUE_NUMBER) ?? deskName.match(ISSUE_NUMBER)
  if (issue) return `#${issue[1]}`
  if (!generic) return ownName(deskName) || firstWord(title) || 'workspace'
  return firstWord(title) || ownName(deskName) || 'workspace'
}

function toStaff(row: Row, deskName: string, generic: boolean, runStops: readonly RunStopWait[]): Staff {
  const specialists = specialistsOf(row)
  const isLeader = isLeaderStaff(row, deskName)
  const matchedStop = matchRunStop(row, runStops)
  const rawName = str(row.conversationName) ?? str(row.displayName) ?? str(row.taskTitle)
  const name =
    matchedStop?.subject && rawName && !rawName.includes(matchedStop.subject)
      ? `${matchedStop.subject} · ${rawName}`
      : (rawName ?? matchedStop?.subject ?? null)
  const state = staffState(row, runStops)
  return {
    id: String(row.paneKey ?? ''),
    agent: str(row.agentType),
    name,
    label: labelOf(name, deskName, generic),
    task: str(row.taskTitle) ?? str(row.prompt)?.slice(0, 140) ?? null,
    tool: str(row.toolName),
    said: str(row.lastAssistantMessage)?.split('\n')[0]?.slice(0, 120) ?? null,
    state,
    line: lineOf(row, state, specialists, isLeader, runStops),
    since: typeof row.stateStartedAt === 'number' ? row.stateStartedAt : 0,
    specialists,
    isLeader
  }
}

const worktreesOf = (raw: unknown): Row[] => {
  const worktrees = (raw as { result?: { worktrees?: unknown } } | null)?.result?.worktrees
  return Array.isArray(worktrees) ? (worktrees as Row[]) : []
}

/**
 * The office from this machine's `worktree ps` answer and each paired server's. A server's desks
 * join the team of their project like any other, their ids prefixed with the server so a desk
 * there never collides with one here, and they carry the selector "Open in Orca" goes through.
 */
export function toSnapshot(
  raw: unknown,
  at: number,
  servers: ServerAnswer[] = [],
  runStops: readonly RunStopWait[] = []
): OfficeSnapshot {
  type Placed = { w: Row; environment: string | null }
  const all: Placed[] = [
    ...worktreesOf(raw).map((w) => ({ w, environment: null })),
    ...servers.flatMap((s) => worktreesOf(s.raw).map((w) => ({ w, environment: s.environment })))
  ]
  const live = all.filter(({ w }) => w.isArchived !== true && Array.isArray(w.agents) && w.agents.length > 0)
  const idOf = (id: string | null, environment: string | null) => (id && environment ? `${environment}|${id}` : id)
  const repoOf = (w: Row) => str(w.repo) ?? 'Other'
  const nameOf = (w: Row) => str(w.displayName) ?? str(w.branch)?.replace(/^refs\/heads\//, '') ?? 'workspace'
  // names several desks in one project share tell those desks apart from nothing
  const seen = new Map<string, number>()
  for (const { w } of live) {
    const key = `${repoOf(w)}\n${nameOf(w).toLowerCase()}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const floors = new Map<string, Desk[]>()
  for (const { w, environment } of live) {
    const agents = w.agents as Row[]
    const repo = repoOf(w)
    const branch = str(w.branch)?.replace(/^refs\/heads\//, '') ?? null
    const name = nameOf(w)
    const defaultBranch = str(w.defaultBranch)?.replace(/^(?:refs\/heads\/|origin\/)/, '') ?? null
    const generic =
      w.isMainWorktree === true ||
      isGenericName(name, defaultBranch) ||
      (seen.get(`${repo}\n${name.toLowerCase()}`) ?? 0) > 1
    const stopsForHost = environment ? [] : runStops
    const desk: Desk = {
      id: idOf(String(w.worktreeId ?? ''), environment) ?? '',
      name,
      branch,
      parentId: idOf(str(w.parentWorktreeId), environment),
      environment,
      host: environment ? str((w.environment as Row | null)?.name) ?? environment : null,
      staff: agents.map((row) => toStaff(row, name, generic, stopsForHost))
    }
    const list = floors.get(repo) ?? []
    list.push(desk)
    floors.set(repo, list)
  }
  const out: Floor[] = [...floors.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, desks]) => ({ repo, desks }))
  return { at, floors: out, error: null }
}

// ---- Open in Orca -------------------------------------------------------------------------------
// The panel has no CLI, so it asks the worker to bring an agent to the front. A terminal agent's
// pane key is `${tabId}:${leafId}` of a row in `orca terminal list --json`, whose handle
// `orca terminal switch` takes. A Chat UI session is not a terminal: its pane key starts with
// `structured-agent-session-` and no CLI command focuses its tab, so the worker shows its
// worktree instead with `orca worktree activate`, as clicking it in the sidebar does. Nothing the
// panel sends reaches the CLI: the pane key only picks a handle or a worktree id from Orca's own
// answers.

const CHAT_SESSION_PREFIX = 'structured-agent-session-'

export const isChatSession = (paneKey: string): boolean => paneKey.startsWith(CHAT_SESSION_PREFIX)

/** `orca terminal switch` for the terminal whose pane key this is, from `orca terminal list --json`. */
export function terminalSwitchArgs(paneKey: string, raw: unknown): string[] | null {
  const terminals = (raw as { result?: { terminals?: Row[] } } | null)?.result?.terminals
  if (!Array.isArray(terminals)) return null
  const exact = terminals.find((t) => `${String(t.tabId ?? '')}:${String(t.leafId ?? '')}` === paneKey)
  const tabId = paneKey.includes(':') ? paneKey.split(':')[0] : ''
  const match = exact ?? (tabId ? terminals.find((t) => String(t.tabId ?? '') === tabId) : undefined)
  const handle = str(match?.handle)
  return handle ? ['terminal', 'switch', '--terminal', handle] : null
}

/** `orca worktree activate` for the worktree the agent with this pane key sits in, from `worktree ps`. */
export function worktreeActivateArgs(paneKey: string, raw: unknown): string[] | null {
  const worktrees = (raw as { result?: { worktrees?: Row[] } } | null)?.result?.worktrees
  if (!Array.isArray(worktrees)) return null
  for (const w of worktrees) {
    const agents = Array.isArray(w.agents) ? (w.agents as Row[]) : []
    if (!agents.some((a) => a.paneKey === paneKey)) continue
    const id = str(w.worktreeId)
    return id ? ['worktree', 'activate', '--worktree', `id:${id}`] : null
  }
  return null
}

const PANE_KEY_MAX = 512

/**
 * Answers 'office.switch'. `run` is the CLI: an argument array in, its parsed JSON out. An agent
 * on a paired server names its `environment`, which must be one Orca itself listed (`known`), so
 * the panel can only pick a server, never pass the CLI a flag of its own.
 */
export async function switchTo(
  input: unknown,
  run: (args: string[]) => Promise<unknown>,
  known: readonly string[] = []
): Promise<SwitchOutcome> {
  const paneKey = str((input as { paneKey?: unknown } | null)?.paneKey)
  if (!paneKey || paneKey.length > PANE_KEY_MAX) return { ok: false, error: 'no pane key' }
  const environment = (input as { environment?: unknown }).environment ?? null
  if (environment !== null && (typeof environment !== 'string' || !known.includes(environment))) {
    return { ok: false, error: 'that Orca server is not paired' }
  }
  const on = environment ? ['--environment', environment] : []
  try {
    let terminal: string[] | null = null
    if (!isChatSession(paneKey)) {
      terminal = terminalSwitchArgs(paneKey, await run(['terminal', 'list', '--json', ...on]))
      if (terminal) {
        const res = await run([...terminal, '--json', ...on])
        const navigated = (res as { result?: { focus?: { navigated?: unknown } } } | null)?.result?.focus?.navigated
        if (navigated !== false) return { ok: true, via: 'terminal' }
      }
    }
    const worktree = worktreeActivateArgs(paneKey, await run(['worktree', 'ps', '--json', ...on]))
    if (!worktree) {
      return terminal ? { ok: true, via: 'terminal' } : { ok: false, error: 'this agent is no longer in Orca' }
    }
    await run([...worktree, '--json', ...on])
    if (terminal) {
      await run([...terminal, '--json', ...on])
      return { ok: true, via: 'terminal' }
    }
    return { ok: true, via: 'worktree' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  let last: OfficeSnapshot = { at: 0, floors: [], error: null }
  let environments: string[] = []
  orca.panels.handle('office.snapshot', async () => {
    try {
      const { local, servers } = await readAllHosts(runCli, (environment, error) =>
        orca.log(`worktree ps on ${environment} failed: ${error instanceof Error ? error.message : String(error)}`)
      )
      environments = pairedEnvironments(local)
      last = toSnapshot(local, Date.now(), servers, readWaitingRunStops())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      orca.log(`worktree ps failed: ${message}`)
      last = { ...last, error: message }
    }
    return last
  })
  orca.panels.handle('office.switch', async (input) => {
    const outcome = await switchTo(input, runCli, environments)
    if (!outcome.ok) orca.log(`open in Orca failed: ${outcome.error}`)
    return outcome
  })
}
