// Reads every agent on this Orca host through `orca worktree ps --json`, the same rows Orca's
// sidebar and phone app draw from. The plugin API's agents.list only covers the focused
// workspace, so the worker asks the CLI instead and trims the answer to what the office draws.
import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Desk, Floor, OfficeSnapshot, Specialist, Staff, StaffState, SwitchOutcome } from './protocol'

const CLI_CANDIDATES = [
  '/Applications/Orca.app/Contents/Resources/bin/orca',
  `${process.env.HOME ?? ''}/Applications/Orca.app/Contents/Resources/bin/orca`
]
const CLI_TIMEOUT_MS = 8000

function cliPath(): string {
  return CLI_CANDIDATES.find((p) => existsSync(p)) ?? 'orca'
}

/** Runs the CLI with an argument array (never a shell) and parses its JSON answer. */
function runCli(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(cliPath(), args, { timeout: CLI_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
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

const runPs = (): Promise<unknown> => runCli(['worktree', 'ps', '--json'])

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function staffState(row: Row): StaffState {
  const state = row.state
  if (state === 'working') return row.workingMode === 'monitoring' ? 'monitoring' : 'working'
  if (state === 'waiting' || state === 'blocked' || state === 'done') return state
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
    p.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '').replace(/^(?:sudo|time|timeout\s+\S+|npx|bunx|exec)\s+/, '')
  const real = parts.map(strip).filter((p) => !/^(?:cd|export|set|source|\.|echo|true|O=|mkdir)\b/.test(p))
  // /Applications/Orca.app/.../bin/orca reads as orca
  return (real[0] ?? strip(parts[0] ?? '')).replace(/^\S*\//, '')
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
  [/^orca\b/, "I'm talking to Orca"],
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

/** The one line an agent says when you click it. */
export function lineOf(row: Row, state: StaffState, specialists: Specialist[]): string {
  const busy = specialists.filter((s) => s.state !== 'done' && s.state !== 'idle')
  if (state === 'waiting') return /ask/i.test(String(row.toolName ?? '')) ? 'I have a question for you' : 'I need you to look'
  if (state === 'blocked') return "I'm stuck, can you help?"
  if (state === 'done') return str(row.lastAssistantMessage)?.split('\n')[0]?.slice(0, 120) ?? 'All done!'
  if (state === 'idle') return "I'm free"
  const tool = str(row.toolName)
  // a specialist's turn: the agent is monitoring, or sits on the Agent call that launched it
  const handedOff = state === 'monitoring' || !tool || /^(?:agent|task)$/i.test(tool)
  if (handedOff && busy.length === 1) return `I'm waiting on the ${clip(busy[0].role ?? 'specialist', 18)}`
  if (handedOff && busy.length > 1) return `I'm waiting on ${busy.length} specialists`
  if (state === 'monitoring') return "I'm waiting on a background job"
  return tool ? toolLine(tool, str(row.toolInput)) : "I'm thinking"
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

function toStaff(row: Row, deskName: string, generic: boolean): Staff {
  const specialists = specialistsOf(row)
  return {
    id: String(row.paneKey ?? ''),
    agent: str(row.agentType),
    name: str(row.conversationName) ?? str(row.displayName) ?? str(row.taskTitle),
    label: labelOf(str(row.conversationName), deskName, generic),
    task: str(row.taskTitle) ?? str(row.prompt)?.slice(0, 140) ?? null,
    tool: str(row.toolName),
    said: str(row.lastAssistantMessage)?.split('\n')[0]?.slice(0, 120) ?? null,
    state: staffState(row),
    line: lineOf(row, staffState(row), specialists),
    since: typeof row.stateStartedAt === 'number' ? row.stateStartedAt : 0,
    specialists
  }
}

export function toSnapshot(raw: unknown, at: number): OfficeSnapshot {
  const result = (raw as { result?: { worktrees?: Row[] } })?.result
  const worktrees = Array.isArray(result?.worktrees) ? result.worktrees : []
  const live = worktrees.filter((w) => w.isArchived !== true && Array.isArray(w.agents) && w.agents.length > 0)
  const repoOf = (w: Row) => str(w.repo) ?? 'Other'
  const nameOf = (w: Row) => str(w.displayName) ?? str(w.branch)?.replace(/^refs\/heads\//, '') ?? 'workspace'
  // names several desks in one project share tell those desks apart from nothing
  const seen = new Map<string, number>()
  for (const w of live) {
    const key = `${repoOf(w)}\n${nameOf(w).toLowerCase()}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const floors = new Map<string, Desk[]>()
  for (const w of live) {
    const agents = w.agents as Row[]
    const repo = repoOf(w)
    const branch = str(w.branch)?.replace(/^refs\/heads\//, '') ?? null
    const name = nameOf(w)
    const defaultBranch = str(w.defaultBranch)?.replace(/^(?:refs\/heads\/|origin\/)/, '') ?? null
    const generic =
      w.isMainWorktree === true ||
      isGenericName(name, defaultBranch) ||
      (seen.get(`${repo}\n${name.toLowerCase()}`) ?? 0) > 1
    const desk: Desk = {
      id: String(w.worktreeId ?? ''),
      name,
      branch,
      parentId: str(w.parentWorktreeId),
      staff: agents.map((row) => toStaff(row, name, generic))
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
  const match = terminals.find((t) => `${String(t.tabId ?? '')}:${String(t.leafId ?? '')}` === paneKey)
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

/** Answers 'office.switch'. `run` is the CLI: an argument array in, its parsed JSON out. */
export async function switchTo(input: unknown, run: (args: string[]) => Promise<unknown>): Promise<SwitchOutcome> {
  const paneKey = str((input as { paneKey?: unknown } | null)?.paneKey)
  if (!paneKey || paneKey.length > PANE_KEY_MAX) return { ok: false, error: 'no pane key' }
  try {
    if (!isChatSession(paneKey)) {
      const terminal = terminalSwitchArgs(paneKey, await run(['terminal', 'list', '--json']))
      if (terminal) {
        await run([...terminal, '--json'])
        return { ok: true, via: 'terminal' }
      }
    }
    const worktree = worktreeActivateArgs(paneKey, await run(['worktree', 'ps', '--json']))
    if (!worktree) return { ok: false, error: 'this agent is no longer in Orca' }
    await run([...worktree, '--json'])
    return { ok: true, via: 'worktree' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  let last: OfficeSnapshot = { at: 0, floors: [], error: null }
  orca.panels.handle('office.snapshot', async () => {
    try {
      last = toSnapshot(await runPs(), Date.now())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      orca.log(`worktree ps failed: ${message}`)
      last = { ...last, error: message }
    }
    return last
  })
  orca.panels.handle('office.switch', async (input) => {
    const outcome = await switchTo(input, runCli)
    if (!outcome.ok) orca.log(`open in Orca failed: ${outcome.error}`)
    return outcome
  })
}
