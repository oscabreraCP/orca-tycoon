// Runs the mapping from `orca worktree ps --json` rows to the office model, and the lookup from
// an agent's pane key to the CLI call that brings it to the front.
import { assert, test } from 'orca/testing'
import { isChatSession, labelOf, switchTo, terminalSwitchArgs, toSnapshot, worktreeActivateArgs } from './worker'

test('groups agents by project and keeps subagents as specialists', () => {
  const raw = {
    result: {
      worktrees: [
        {
          worktreeId: 'w1',
          repo: 'infra',
          branch: 'refs/heads/main',
          displayName: 'main',
          agents: [
            {
              paneKey: 'p1',
              state: 'working',
              agentType: 'claude',
              taskTitle: 'SRE-213',
              stateStartedAt: 5,
              subagents: [{ id: 's1', agentType: 'release-engineer', description: 'Build watcher', state: 'working' }]
            }
          ]
        },
        { worktreeId: 'w2', repo: 'infra', agents: [] },
        {
          worktreeId: 'w3',
          repo: 'client-portal',
          displayName: 'TTM-2076',
          agents: [{ paneKey: 'p3', state: 'working', workingMode: 'monitoring' }]
        }
      ]
    }
  }
  const snap = toSnapshot(raw, 1)
  assert.deepEqual(snap.floors.map((f) => f.repo), ['client-portal', 'infra'])
  const infra = snap.floors[1].desks[0]
  assert.equal(infra.branch, 'main')
  assert.equal(infra.staff[0].specialists[0].role, 'release-engineer')
  assert.equal(snap.floors[0].desks[0].staff[0].state, 'monitoring')
})

test('reads Chat UI children as specialists, leaving out commands and settled work', () => {
  const agent = (children: unknown[], subagents?: unknown[]) => ({
    result: {
      worktrees: [
        {
          worktreeId: 'w1',
          repo: 'infra',
          displayName: 'SRE-200',
          agents: [{ paneKey: 'p1', state: 'working', agentType: 'claude', children, subagents }]
        }
      ]
    }
  })
  const children = [
    {
      id: 'c1',
      providerId: 'a7a0',
      kind: 'agent',
      agentType: 'release-engineer',
      description: 'SRE-200 workflow schedule',
      state: 'working',
      membership: 'live'
    },
    { id: 'c2', providerId: 'b1', kind: 'command', description: 'Watch the run', state: 'working', membership: 'live' },
    { id: 'c3', kind: 'agent', name: 'reviewer', state: 'done', membership: 'settled' },
    { id: 'c4', kind: 'workflow', name: 'review-changes', state: 'monitoring', membership: 'live' }
  ]
  const staff = toSnapshot(agent(children), 1).floors[0].desks[0].staff[0]
  assert.deepEqual(
    staff.specialists.map((s) => [s.id, s.role, s.state]),
    [
      ['a7a0', 'release-engineer', 'working'],
      ['c4', 'review-changes', 'monitoring']
    ]
  )
  assert.equal(staff.specialists[0].task, 'SRE-200 workflow schedule')
  // An explicit empty children list wins over a stale subagents roster.
  const old = [{ id: 's1', agentType: 'x', state: 'working' }]
  assert.equal(toSnapshot(agent([], old), 1).floors[0].desks[0].staff[0].specialists.length, 0)
})

test('agents say one short line about what they are doing', () => {
  const say = (row: Record<string, unknown>, subs: unknown[] = []) => {
    const raw = { result: { worktrees: [{ worktreeId: 'w', repo: 'r', agents: [{ paneKey: 'p', ...row, subagents: subs }] }] } }
    return toSnapshot(raw, 1).floors[0].desks[0].staff[0].line
  }
  const bash = (command: string) => say({ state: 'working', toolName: 'Bash', toolInput: command })
  assert.equal(bash('gh run watch 42620993132 -R tatomahq/infra --exit-status'), "I'm watching CI run")
  assert.equal(bash('cd ~/code/app && gh pr checks 12'), "I'm checking the PR's checks")
  assert.equal(bash('CI=1 pnpm -F web test'), "I'm running the tests")
  assert.equal(bash('git push -q origin main'), "I'm pushing my branch")
  assert.equal(bash('pnpm -F web lint'), "I'm running the checks")
  assert.equal(bash('make deploy'), "I'm running make")
  assert.equal(bash('/Applications/Orca.app/Contents/Resources/bin/orca worktree ps --json'), "I'm talking to Orca")
  assert.equal(say({ state: 'working', toolName: 'Edit', toolInput: '/Users/x/app/src/panel.js' }), "I'm editing panel.js")
  assert.equal(say({ state: 'working', toolName: 'Read', toolInput: 'src/worker.ts' }), "I'm reading worker.ts")
  assert.equal(say({ state: 'working', toolName: 'Grep', toolInput: 'lineOf' }), "I'm searching the code")
  assert.equal(say({ state: 'working', toolName: 'WebFetch', toolInput: 'https://www.onorca.dev/plugins' }), "I'm reading onorca.dev")
  assert.equal(say({ state: 'working', toolName: 'mcp__claude_ai_Linear__save_comment' }), "I'm using Linear")
  assert.equal(say({ state: 'working', toolName: 'mcp__plugin_figma_figma__get_design' }), "I'm using figma")
  assert.equal(say({ state: 'working', toolName: null }), "I'm thinking")
  // a specialist's turn, but only when the agent is not busy with a tool of its own
  const sub = [{ id: 's', agentType: 'release-engineer', state: 'working' }]
  assert.equal(say({ state: 'working', toolName: 'Agent' }, sub), "I'm waiting on the release-engineer")
  assert.equal(say({ state: 'working', workingMode: 'monitoring', toolName: 'Bash' }, [...sub, { ...sub[0], id: 't' }]), "I'm waiting on 2 specialists")
  assert.equal(say({ state: 'working', toolName: 'Bash', toolInput: 'git status' }, sub), "I'm looking at the changes")
  assert.equal(say({ state: 'working', workingMode: 'monitoring' }), "I'm waiting on a background job")
  assert.equal(say({ state: 'waiting', toolName: 'AskUserQuestion' }), 'I have a question for you')
  assert.equal(say({ state: 'blocked' }), "I'm stuck, can you help?")
  assert.equal(say({ state: 'done', lastAssistantMessage: 'Merged #12.\nMore below' }), 'Merged #12.')
})

test('a seat is labelled by ticket, issue number, first word of the title, then the workspace', () => {
  // a ticket key in the conversation name wins, then one in the workspace name
  assert.equal(labelOf('IT-73625 Mail routing broke', 'main'), 'IT-73625')
  assert.equal(labelOf('Checkout redesign', 'WEB-142 Checkout redesign'), 'WEB-142')
  assert.equal(labelOf('Fix cart totals', 'tommy/web-151-fix-cart-totals'), 'Fix')
  // an issue number is next, from either name
  assert.equal(labelOf('Issue #19977: flaky build', 'main'), '#19977')
  assert.equal(labelOf('Flaky build', 'issue-#19977'), '#19977')
  // then the first word of the conversation title, past leading symbols and trailing punctuation
  assert.equal(labelOf('Assistant name question', 'main'), 'Assistant')
  assert.equal(labelOf('  [WIP] Desk labels: ticket key', 'main'), 'WIP')
  assert.equal(labelOf('- fix: cart totals', 'main'), 'fix')
  assert.equal(labelOf('"Palu" gets bowls', 'main'), 'Palu')
  assert.equal(labelOf('feat/labels', 'main'), 'feat')
  // else what the nameplate showed before: the first word of the workspace name
  assert.equal(labelOf(null, 'main'), 'main')
  assert.equal(labelOf('', 'feature/login form'), 'feature')
  assert.equal(labelOf('***', 'main'), 'main')
  // never empty
  assert.equal(labelOf('...', '---'), '---')
  assert.equal(labelOf(null, ''), 'workspace')
})

test('staff carry their nameplate label', () => {
  const raw = {
    result: {
      worktrees: [
        {
          worktreeId: 'w1',
          repo: 'infra',
          branch: 'refs/heads/main',
          displayName: 'main',
          agents: [
            { paneKey: 'p1', state: 'working', conversationName: 'SRE-213 Rotate the backup key' },
            { paneKey: 'p2', state: 'working', conversationName: 'Assistant name question' },
            { paneKey: 'p3', state: 'idle' }
          ]
        }
      ]
    }
  }
  const staff = toSnapshot(raw, 1).floors[0].desks[0].staff
  assert.deepEqual(staff.map((s) => s.label), ['SRE-213', 'Assistant', 'main'])
})

// ---- Open in Orca -------------------------------------------------------------------------------

const TERMINALS = {
  result: {
    terminals: [
      { handle: 'term_aaa', tabId: 'tab-1', leafId: 'leaf-1', title: 'one' },
      { handle: 'term_bbb', tabId: 'tab-2', leafId: 'leaf-2', title: 'two' },
      { tabId: 'tab-3', leafId: 'leaf-3', title: 'no handle yet' }
    ]
  }
}
const PS = {
  result: {
    worktrees: [
      { worktreeId: 'repo::/w/one', agents: [{ paneKey: 'tab-1:leaf-1' }] },
      { worktreeId: 'repo::/w/chat', agents: [{ paneKey: 'structured-agent-session-abc:leaf-9' }] },
      { worktreeId: '', agents: [{ paneKey: 'tab-7:leaf-7' }] }
    ]
  }
}

test('finds the terminal handle for a pane key, and nothing for the rest', () => {
  assert.deepEqual(terminalSwitchArgs('tab-2:leaf-2', TERMINALS), ['terminal', 'switch', '--terminal', 'term_bbb'])
  // the whole key, never the tab or the leaf on its own
  assert.equal(terminalSwitchArgs('tab-2', TERMINALS), null)
  assert.equal(terminalSwitchArgs('leaf-2', TERMINALS), null)
  assert.equal(terminalSwitchArgs('tab-3:leaf-3', TERMINALS), null)
  assert.equal(terminalSwitchArgs('tab-1:leaf-1', { result: {} }), null)
  assert.equal(terminalSwitchArgs('tab-1:leaf-1', null), null)
})

test('a Chat UI session is told by its pane key and gets its worktree instead', () => {
  assert.equal(isChatSession('structured-agent-session-abc:leaf-9'), true)
  assert.equal(isChatSession('tab-1:leaf-1'), false)
  assert.deepEqual(worktreeActivateArgs('structured-agent-session-abc:leaf-9', PS), [
    'worktree',
    'activate',
    '--worktree',
    'id:repo::/w/chat'
  ])
  assert.deepEqual(worktreeActivateArgs('tab-1:leaf-1', PS), ['worktree', 'activate', '--worktree', 'id:repo::/w/one'])
  assert.equal(worktreeActivateArgs('tab-7:leaf-7', PS), null)
  assert.equal(worktreeActivateArgs('tab-0:leaf-0', PS), null)
  assert.equal(worktreeActivateArgs('tab-1:leaf-1', undefined), null)
})

test('switchTo runs only the lookup and the one switch, with the CLI injected', async () => {
  const calls: string[][] = []
  const cli = (answers: Record<string, unknown>) => async (args: string[]) => {
    calls.push(args)
    return answers[args.slice(0, 2).join(' ')] ?? { ok: true }
  }
  // a terminal agent: list, then switch to its handle
  assert.deepEqual(await switchTo({ paneKey: 'tab-1:leaf-1' }, cli({ 'terminal list': TERMINALS })), { ok: true, via: 'terminal' })
  assert.deepEqual(calls, [
    ['terminal', 'list', '--json'],
    ['terminal', 'switch', '--terminal', 'term_aaa', '--json']
  ])
  // a Chat UI session: never asks for terminals, reveals the worktree
  calls.length = 0
  assert.deepEqual(
    await switchTo({ paneKey: 'structured-agent-session-abc:leaf-9' }, cli({ 'worktree ps': PS })),
    { ok: true, via: 'worktree' }
  )
  assert.deepEqual(calls, [
    ['worktree', 'ps', '--json'],
    ['worktree', 'activate', '--worktree', 'id:repo::/w/chat', '--json']
  ])
  // a terminal that is gone but an agent still in ps falls back to its worktree
  calls.length = 0
  assert.deepEqual(
    await switchTo({ paneKey: 'tab-1:leaf-1' }, cli({ 'terminal list': { result: { terminals: [] } }, 'worktree ps': PS })),
    { ok: true, via: 'worktree' }
  )
  assert.deepEqual(calls.map((c) => c.slice(0, 2).join(' ')), ['terminal list', 'worktree ps', 'worktree activate'])
  // nothing matches anywhere
  calls.length = 0
  const gone = await switchTo({ paneKey: 'tab-0:leaf-0' }, cli({ 'terminal list': TERMINALS, 'worktree ps': PS }))
  assert.equal(gone.ok, false)
  assert.deepEqual(calls.map((c) => c[1]), ['list', 'ps'])
  // the CLI refusing
  const refused = await switchTo({ paneKey: 'tab-1:leaf-1' }, async (args) =>
    args[1] === 'switch' ? Promise.reject(new Error('terminal_handle_stale')) : TERMINALS
  )
  assert.deepEqual(refused, { ok: false, error: 'terminal_handle_stale' })
})

test('switchTo refuses anything but a pane key without touching the CLI', async () => {
  const calls: string[][] = []
  const spy = async (args: string[]) => {
    calls.push(args)
    return TERMINALS
  }
  for (const bad of [undefined, null, 'tab-1:leaf-1', 42, {}, { paneKey: '' }, { paneKey: '   ' }, { paneKey: 7 }, { paneKey: ['x'] }]) {
    const out = await switchTo(bad, spy)
    assert.equal(out.ok, false, `accepted ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(calls, [])
})
