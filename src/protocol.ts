// The panel <-> worker contract, declared once: src/panel.js and src/worker.ts both read it.
export {}

export type StaffState = 'working' | 'monitoring' | 'waiting' | 'blocked' | 'done' | 'idle'

/** A subagent: a specialist the agent called in, seated on a stool at its desk. */
export type Specialist = {
  id: string
  role: string | null
  task: string | null
  state: StaffState
}

export type Staff = {
  id: string
  agent: string | null
  name: string | null
  task: string | null
  tool: string | null
  /** First line of the agent's last reply, for its speech bubble. */
  said: string | null
  state: StaffState
  /** What the agent says when you click it: "I'm editing panel.js", "I'm watching CI run". */
  line: string
  /** The nameplate on its desk: a ticket key, an issue number or the first word of its title. */
  label: string
  since: number
  specialists: Specialist[]
}

export type Desk = {
  id: string
  name: string
  branch: string | null
  parentId: string | null
  staff: Staff[]
}

export type Floor = { repo: string; desks: Desk[] }

export type OfficeSnapshot = {
  at: number
  floors: Floor[]
  error: string | null
}

/** What came of "Open in Orca": the agent's terminal tab came up, or only its worktree could. */
export type SwitchOutcome = { ok: true; via: 'terminal' | 'worktree' } | { ok: false; error: string }

declare module 'orca' {
  interface PluginRequests {
    /** Every workspace with its agents and their subagents, grouped by project. */
    'office.snapshot': { output: OfficeSnapshot }
    /** Brings an agent to the front in Orca: its terminal tab, or its worktree for a Chat UI session. */
    'office.switch': { input: { paneKey: string }; output: SwitchOutcome }
  }
}
