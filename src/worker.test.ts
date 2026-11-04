// Runs the mapping from `orca worktree ps --json` rows to the office model.
import { assert, test } from 'orca/testing'
import { toSnapshot } from './worker'

test('groups agents by project and keeps subagents as interns', () => {
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
  assert.equal(infra.staff[0].interns[0].role, 'release-engineer')
  assert.equal(snap.floors[0].desks[0].staff[0].state, 'monitoring')
})
