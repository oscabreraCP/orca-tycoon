import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3456
const HOST = '127.0.0.1' // localhost only

const isBatchFile = (command) => /\.(?:cmd|bat)$/i.test(command)

function cliCandidates() {
  const platform = process.platform
  const env = process.env
  const resourcesPath = process.resourcesPath ?? null
  const candidates = []
  const push = (p) => {
    const trimmed = p?.trim()
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed)
  }

  push(env.ORCA_CLI_COMMAND)

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
    push('/usr/local/bin/orca')
    push('/usr/bin/orca-ide')
    push('/usr/bin/orca')
  } else {
    push('/Applications/Orca.app/Contents/Resources/bin/orca')
    if (env.HOME?.trim()) {
      push(`${env.HOME.trim().replace(/\/+$/, '')}/Applications/Orca.app/Contents/Resources/bin/orca`)
    }
  }

  return candidates
}

function resolveCliTarget() {
  const platform = process.platform
  const found = cliCandidates().find((p) => fs.existsSync(p))
  if (found) {
    return { command: found, shell: platform === 'win32' && isBatchFile(found) }
  }
  if (platform === 'win32') {
    return { command: 'orca.exe', shell: false, fallbackCommand: 'orca.cmd' }
  }
  return { command: 'orca', shell: false }
}

function execCliJson(args, timeout = 8000) {
  const target = resolveCliTarget()
  const runOnce = (command, shell) =>
    new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        { timeout, maxBuffer: 32 * 1024 * 1024, shell },
        (error, stdout) => {
          if (error && !stdout) return reject(error)
          try {
            resolve(JSON.parse(stdout))
          } catch (e) {
            reject(error ?? e)
          }
        }
      )
    })

  return runOnce(target.command, target.shell).catch((err) => {
    if (target.fallbackCommand && (err?.code === 'ENOENT' || err?.code === 'EINVAL')) {
      return runOnce(target.fallbackCommand, isBatchFile(target.fallbackCommand))
    }
    throw err
  })
}

function runPs() {
  return execCliJson(['worktree', 'ps', '--agent-wait', '--json'])
}

async function switchTerminal(paneKey) {
  try {
    const data = await execCliJson(['terminal', 'list', '--json'])
    const terminals = data?.result?.terminals
    if (Array.isArray(terminals)) {
      const match = terminals.find((t) => {
        const tabId = String(t.tabId ?? '')
        const leafId = String(t.leafId ?? '')
        const key = `${tabId}:${leafId}`
        return key === paneKey || tabId === paneKey || leafId === paneKey
      })
      if (match && match.handle) {
        await execCliJson(['terminal', 'switch', '--terminal', String(match.handle), '--json'])
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function staffState(row) {
  if (row.agentWait != null && (typeof row.agentWait !== 'object' || Object.keys(row.agentWait).length > 0)) {
    return 'waiting'
  }
  const state = row.state
  if (state === 'working') {
    if (row.workingMode !== 'monitoring' && row.programStatus && typeof row.programStatus === 'object') {
      const prog = row.programStatus.state
      if (prog && prog !== 'working') return prog === 'done' ? 'done' : 'idle'
    }
    return row.workingMode === 'monitoring' ? 'monitoring' : 'working'
  }
  if (state === 'waiting' || state === 'blocked' || state === 'done') return state
  return 'idle'
}

function specialistState(state) {
  if (state === 'working' || state === 'waiting' || state === 'blocked' || state === 'done') {
    return state
  }
  return 'idle'
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

function isLeaderStaff(row) {
  const name = str(row.conversationName) ?? str(row.displayName) ?? str(row.taskTitle) ?? ''
  const prompt = str(row.prompt) ?? ''
  const title = str(row.taskTitle) ?? ''
  const activityTitle = str(row.activity?.title) ?? ''

  if (LEADER_NAME_PATTERNS.some((p) => p.test(name) || p.test(title) || p.test(activityTitle))) {
    return true
  }

  if (LEADER_PROMPT_PATTERNS.some((p) => p.test(prompt))) {
    return true
  }

  return false
}

function toStaff(row) {
  const subs = Array.isArray(row.subagents) ? row.subagents : []
  const specialists = subs.map((s) => ({
    id: String(s.id ?? ''),
    role: str(s.agentType),
    task: str(s.description),
    state: specialistState(s.state)
  }))
  const isLeader = isLeaderStaff(row)
  return {
    id: String(row.paneKey ?? ''),
    agent: str(row.agentType),
    name: str(row.conversationName) ?? str(row.displayName) ?? str(row.taskTitle),
    task: str(row.taskTitle) ?? str(row.prompt)?.slice(0, 140) ?? null,
    tool: str(row.toolName),
    said: str(row.lastAssistantMessage)?.split('\n')[0]?.slice(0, 120) ?? null,
    state: staffState(row),
    line: isLeader ? 'Coordinating workers' : (str(row.statusMessage) ?? (str(row.toolName) ? `using ${row.toolName}` : 'working')),
    label: str(row.conversationName) ?? '',
    since: typeof row.stateStartedAt === 'number' ? row.stateStartedAt : 0,
    specialists,
    isLeader
  }
}

function toSnapshot(raw, at) {
  const result = raw?.result
  const worktrees = Array.isArray(result?.worktrees) ? result.worktrees : []
  const floors = new Map()
  for (const w of worktrees) {
    if (w.isArchived === true) continue
    const agents = Array.isArray(w.agents) ? w.agents : []
    if (agents.length === 0) continue
    const repo = str(w.repo) ?? 'Other'
    const branch = str(w.branch)?.replace(/^refs\/heads\//, '') ?? null
    const desk = {
      id: String(w.worktreeId ?? ''),
      name: str(w.displayName) ?? branch ?? 'workspace',
      branch,
      parentId: str(w.parentWorktreeId),
      environment: null,
      host: null,
      staff: agents.map(toStaff)
    }
    const list = floors.get(repo) ?? []
    list.push(desk)
    floors.set(repo, list)
  }
  const out = [...floors.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, desks]) => ({ repo, desks }))
  return { at, floors: out, error: null }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8'
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)

  // API: Get snapshot
  if (url.pathname === '/api/snapshot' && req.method === 'GET') {
    try {
      const raw = await runPs()
      const snap = toSnapshot(raw, Date.now())
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(snap))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // API: Switch terminal
  if (url.pathname === '/api/switch' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const { paneKey } = JSON.parse(body || '{}')
        const ok = paneKey ? await switchTerminal(paneKey) : false
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // Static files
  let reqPath = url.pathname === '/' ? '/src/panel.html' : url.pathname
  let filePath = path.join(__dirname, reqPath.startsWith('/src/') ? reqPath : `/src/${reqPath}`)

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Check root directory fallback (docs, etc)
    const altPath = path.join(__dirname, reqPath)
    if (fs.existsSync(altPath) && !fs.statSync(altPath).isDirectory()) {
      filePath = altPath
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }
  }

  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, HOST, () => {
  console.log(`Orca Tycoon localhost server running at http://${HOST}:${PORT}`)
})
