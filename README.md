# Orca Tycoon

An [Orca](https://github.com/stablyai/orca) plugin that shows every agent on your Orca host as a
little pixel worker in an office, in the spirit of tycoon and office-sim games.

- Each project is an open area on one office floor.
- Each worktree is a seat at a shared desk; a worktree's child worktrees sit next to it.
- Subagents are interns walking around in front of their parent's desk.
- Monitors face you, so you can read what each agent is doing at a glance.
- An agent whose turn is over but whose background tasks still run gets up, walks to the coffee
  corner, and walks back when the tasks finish.
- When an agent finishes, a speech bubble shows the first line of its last reply.

| Agent state | What you see |
| --- | --- |
| working | typing, code scrolling on screen |
| monitoring (background tasks) | away at the water dispenser or coffee machine, mug in hand |
| waiting for you | amber `?` on screen |
| blocked | red flashing screen with `!` |
| done | dozing, `z` |

Click a seat to pin its speech bubble and see the worktree, state, task, tool and interns.

## How it works

Orca's plugin API (`agents.list`) only lists the agents of the focused workspace, and it has no
subagents. The worker (`src/worker.ts`) instead runs `orca worktree ps --json`, the same rows
Orca's sidebar and phone app draw from, and trims them to an office model (`src/protocol.ts`).
The panel (`src/panel.html`, `src/panel.js`, `src/sprites.js`) polls the worker every 3 seconds,
the rate Orca's phone app polls at, and draws one canvas at 8 frames a second. All sprites are
drawn in code; the plugin loads no assets and makes no network requests.

Because the worker runs the Orca CLI, the plugin needs the `trusted-worker` execution profile.
It asks for no other capabilities.

## Install

Requires Orca 1.4.246 or newer. The worker looks for the CLI at
`/Applications/Orca.app/Contents/Resources/bin/orca`, then `~/Applications/...`, then `orca` on
`PATH`.

```sh
git clone https://github.com/palulabs/orca-tycoon.git
cd orca-tycoon
orca plugin dev load .        # prints an approval; re-run with the --approve flag it shows
orca plugin open local.orca-tycoon --panel office
```

## Develop

```sh
orca plugin validate .
orca plugin test .            # src/worker.test.ts: ps rows to the office model
orca plugin dev reload .      # after editing; the panel redraws
orca plugin shot local.orca-tycoon --panel office --out shot.png
```

`AWAY_STATES` at the top of `src/panel.js` decides which states send an agent to the coffee
corner.
