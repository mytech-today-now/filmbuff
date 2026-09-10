# Command Help Reference

Auto-generated command-line help for Augment workflow tools.

**Generated**: 2026-03-19T15:40:08.615Z
**Tools**: Augx, Beads, OpenSpec
**Version**: 2.5.2

---

## Augx Commands (augx)

### augx --help

```
Usage: augx [options] [command]

CLI tool for managing Augment Code AI extension modules

Options:
  -V, --version                        output the version number
  -h, --help                           display help for command

Commands:
  init [options]                       Initialize Augment Extensions in current
                                       project (includes Beads integration if
                                       .beads/ exists)
  gui                                  Launch interactive GUI for module
                                       management
  list [options]                       List available or linked extension
                                       modules
  show [options] <module> [file-path]  Display detailed information about a
                                       module (use "completed" to show Beads
                                       completed tasks with --completed-search,
                                       "linked" for linked modules, "all" for
                                       all modules)
  use [options] <module>               Select and load a specific module
                                       version
  upgrade [options] <module>           Upgrade module to latest version
  version-info [options] <module>      Show detailed version information
  link [options] <module>              Link an extension module to current
                                       project
  unlink [options] <module>            Unlink an extension module or collection
                                       from current project
  update [options]                     Update CLI and/or linked modules to
                                       latest versions
  search [options] <keyword>           Search for extension modules
  create [options] <name>              Create a new extension module
  validate [options] <module>          Validate module structure and metadata
  pin <module> <version>               Pin module to specific version
  check-updates                        Check for available module updates
  self-remove [options]                Completely remove all Augment Extensions
                                       from the project
  diff <module>                        Show differences between current and
                                       latest version
  catalog [options]                    Update MODULES.md catalog with all
                                       available modules
  catalog-hook [options]               Setup git hook for automatic catalog
                                       updates
  install-rules [options]              Install character count management rule
                                       to .augment/rules
  coord                                Query coordination manifest data
  sync                                 Sync Beads and OpenSpec with
                                       coordination manifest
  migrate                              Migrate existing Beads and OpenSpec data
                                       to coordination system
  skill                                Manage skills
  mcp                                  Manage MCP server integrations
  code-analysis|analyze [options]      Analyze code for quality, complexity,
                                       security, and dependencies
  generate-shot-list [options]         Generate AI-optimized shot lists from
                                       screenplays
  help [command]                       display help for command

```

#### augx init --help

```
Usage: augx init [options] [command]

Initialize Augment Extensions in current project (includes Beads integration if
.beads/ exists)

Options:
  --from-submodule  Initialize from existing submodule
  -h, --help        display help for command

Commands:
  beads             Initialize Beads task tracking in current project

```

##### augx init beads --help

```
Usage: augx init beads [options]

Initialize Beads task tracking in current project

Options:
  -h, --help  display help for command

```

#### augx project --help

```
Usage: augx [options] [command]

CLI tool for managing Augment Code AI extension modules

Options:
  -V, --version                        output the version number
  -h, --help                           display help for command

Commands:
  init [options]                       Initialize Augment Extensions in current
                                       project (includes Beads integration if
                                       .beads/ exists)
  gui                                  Launch interactive GUI for module
                                       management
  list [options]                       List available or linked extension
                                       modules
  show [options] <module> [file-path]  Display detailed information about a
                                       module (use "completed" to show Beads
                                       completed tasks with --completed-search,
                                       "linked" for linked modules, "all" for
                                       all modules)
  use [options] <module>               Select and load a specific module
                                       version
  upgrade [options] <module>           Upgrade module to latest version
  version-info [options] <module>      Show detailed version information
  link [options] <module>              Link an extension module to current
                                       project
  unlink [options] <module>            Unlink an extension module or collection
                                       from current project
  update [options]                     Update CLI and/or linked modules to
                                       latest versions
  search [options] <keyword>           Search for extension modules
  create [options] <name>              Create a new extension module
  validate [options] <module>          Validate module structure and metadata
  pin <module> <version>               Pin module to specific version
  check-updates                        Check for available module updates
  self-remove [options]                Completely remove all Augment Extensions
                                       from the project
  diff <module>                        Show differences between current and
                                       latest version
  catalog [options]                    Update MODULES.md catalog with all
                                       available modules
  catalog-hook [options]               Setup git hook for automatic catalog
                                       updates
  install-rules [options]              Install character count management rule
                                       to .augment/rules
  coord                                Query coordination manifest data
  sync                                 Sync Beads and OpenSpec with
                                       coordination manifest
  migrate                              Migrate existing Beads and OpenSpec data
                                       to coordination system
  skill                                Manage skills
  mcp                                  Manage MCP server integrations
  code-analysis|analyze [options]      Analyze code for quality, complexity,
                                       security, and dependencies
  generate-shot-list [options]         Generate AI-optimized shot lists from
                                       screenplays
  help [command]                       display help for command

```

##### augx project init --help

```
Usage: augx [options] [command]

CLI tool for managing Augment Code AI extension modules

Options:
  -V, --version                        output the version number
  -h, --help                           display help for command

Commands:
  init [options]                       Initialize Augment Extensions in current
                                       project (includes Beads integration if
                                       .beads/ exists)
  gui                                  Launch interactive GUI for module
                                       management
  list [options]                       List available or linked extension
                                       modules
  show [options] <module> [file-path]  Display detailed information about a
                                       module (use "completed" to show Beads
                                       completed tasks with --completed-search,
                                       "linked" for linked modules, "all" for
                                       all modules)
  use [options] <module>               Select and load a specific module
                                       version
  upgrade [options] <module>           Upgrade module to latest version
  version-info [options] <module>      Show detailed version information
  link [options] <module>              Link an extension module to current
                                       project
  unlink [options] <module>            Unlink an extension module or collection
                                       from current project
  update [options]                     Update CLI and/or linked modules to
                                       latest versions
  search [options] <keyword>           Search for extension modules
  create [options] <name>              Create a new extension module
  validate [options] <module>          Validate module structure and metadata
  pin <module> <version>               Pin module to specific version
  check-updates                        Check for available module updates
  self-remove [options]                Completely remove all Augment Extensions
                                       from the project
  diff <module>                        Show differences between current and
                                       latest version
  catalog [options]                    Update MODULES.md catalog with all
                                       available modules
  catalog-hook [options]               Setup git hook for automatic catalog
                                       updates
  install-rules [options]              Install character count management rule
                                       to .augment/rules
  coord                                Query coordination manifest data
  sync                                 Sync Beads and OpenSpec with
                                       coordination manifest
  migrate                              Migrate existing Beads and OpenSpec data
                                       to coordination system
  skill                                Manage skills
  mcp                                  Manage MCP server integrations
  code-analysis|analyze [options]      Analyze code for quality, complexity,
                                       security, and dependencies
  generate-shot-list [options]         Generate AI-optimized shot lists from
                                       screenplays
  help [command]                       display help for command

```

##### augx project project --help

```
Usage: augx [options] [command]

CLI tool for managing Augment Code AI extension modules

Options:
  -V, --version                        output the version number
  -h, --help                           display help for command

Commands:
  init [options]                       Initialize Augment Extensions in current
                                       project (includes Beads integration if
                                       .beads/ exists)
  gui                                  Launch interactive GUI for module
                                       management
  list [options]                       List available or linked extension
                                       modules
  show [options] <module> [file-path]  Display detailed information about a
                                       module (use "completed" to show Beads
                                       completed tasks with --completed-search,
                                       "linked" for linked modules, "all" for
                                       all modules)
  use [options] <module>               Select and load a specific module
                                       version
  upgrade [options] <module>           Upgrade module to latest version
  version-info [options] <module>      Show detailed version information
  link [options] <module>              Link an extension module to current
                                       project
  unlink [options] <module>            Unlink an extension module or collection
                                       from current project
  update [options]                     Update CLI and/or linked modules to
                                       latest versions
  search [options] <keyword>           Search for extension modules
  create [options] <name>              Create a new extension module
  validate [options] <module>          Validate module structure and metadata
  pin <module> <version>               Pin module to specific version
  check-updates                        Check for available module updates
  self-remove [options]                Completely remove all Augment Extensions
                                       from the project
  diff <module>                        Show differences between current and
                                       latest version
  catalog [options]                    Update MODULES.md catalog with all
                                       available modules
  catalog-hook [options]               Setup git hook for automatic catalog
                                       updates
  install-rules [options]              Install character count management rule
                                       to .augment/rules
  coord                                Query coordination manifest data
  sync                                 Sync Beads and OpenSpec with
                                       coordination manifest
  migrate                              Migrate existing Beads and OpenSpec data
                                       to coordination system
  skill                                Manage skills
  mcp                                  Manage MCP server integrations
  code-analysis|analyze [options]      Analyze code for quality, complexity,
                                       security, and dependencies
  generate-shot-list [options]         Generate AI-optimized shot lists from
                                       screenplays
  help [command]                       display help for command

```

---

## Beads Commands (bd)

### bd --help

```
Issues chained together like beads. A lightweight issue tracker with first-class dependency support.

Usage:
  bd [flags]
  bd [command]

Working With Issues:
  children        List child beads of a parent
  close           Close one or more issues
  comments        View or manage comments on an issue
  create          Create a new issue (or multiple issues from markdown file)
  create-form     Create a new issue using an interactive form
  delete          Delete one or more issues and clean up references
  edit            Edit an issue field in $EDITOR
  gate            Manage async coordination gates
  label           Manage issue labels
  list            List issues
  merge-slot      Manage merge-slot gates for serialized conflict resolution
  move            Move an issue to a different rig with dependency remapping
  promote         Promote a wisp to a permanent bead
  q               Quick capture: create issue and output only ID
  query           Query issues using a simple query language
  refile          Move an issue to a different rig
  reopen          Reopen one or more closed issues
  search          Search issues by text query
  set-state       Set operational state (creates event + updates label)
  show            Show issue details
  state           Query the current value of a state dimension
  todo            Manage TODO items (convenience wrapper for task issues)
  update          Update one or more issues

Views & Reports:
  count           Count issues matching filters
  diff            Show changes between two commits or branches (requires Dolt backend)
  find-duplicates Find semantically similar issues using text analysis or AI
  history         Show version history for an issue (requires Dolt backend)
  lint            Check issues for missing template sections
  stale           Show stale issues (not updated recently)
  status          Show issue database overview and statistics
  types           List valid issue types

Dependencies & Structure:
  dep             Manage dependencies
  duplicate       Mark an issue as a duplicate of another
  duplicates      Find and optionally merge duplicate issues
  epic            Epic management commands
  graph           Display issue dependency graph
  supersede       Mark an issue as superseded by a newer one
  swarm           Swarm management for structured epics

Sync & Data:
  backup          Back up your beads database
  branch          List or create branches (requires Dolt backend)
  export          Export issues to JSONL format
  federation      Manage peer-to-peer federation with other Gas Towns
  restore         Restore full history of a compacted issue from Dolt history
  vc              Version control operations (requires Dolt backend)

Setup & Configuration:
  bootstrap       Non-destructive database setup for fresh clones and recovery
  config          Manage configuration settings
  context         Show effective backend identity and repository context
  dolt            Configure Dolt database settings
  forget          Remove a persistent memory
  hooks           Manage git hooks for beads integration
  human           Show essential commands for human users
  info            Show database information
  init            Initialize bd in the current directory
  kv              Key-value store commands
  memories        List or search persistent memories
  onboard         Display minimal snippet for AGENTS.md
  prime           Output AI-optimized workflow context
  quickstart      Quick start guide for bd
  recall          Retrieve a specific memory
  remember        Store a persistent memory
  setup           Setup integration with AI editors
  where           Show active beads location

Maintenance:
  compact         Squash old Dolt commits to reduce history size
  doctor          Check and fix beads installation health (start here)
  flatten         Squash all Dolt history into a single commit
  gc              Garbage collect: decay old issues, compact Dolt commits, run Dolt GC
  migrate         Database migration commands
  preflight       Show PR readiness checklist
  purge           Delete closed ephemeral beads to reclaim space
  rename-prefix   Rename the issue prefix for all issues in the database
  sql             Execute raw SQL against the beads database
  upgrade         Check and manage bd version upgrades
  worktree        Manage git worktrees for parallel development

Integrations & Advanced:
  admin           Administrative commands for database maintenance
  jira            Jira integration commands
  linear          Linear integration commands
  repo            Manage multiple repository configuration

Additional Commands:
  agent           Manage agent bead state
  audit           Record and label agent interactions (append-only JSONL)
  blocked         Show blocked issues
  completion      Generate the autocompletion script for the specified shell
  cook            Compile a formula into a proto (ephemeral by default)
  defer           Defer one or more issues for later
  formula         Manage workflow formulas
  github          GitHub integration commands
  gitlab          GitLab integration commands
  help            Help about any command
  mail            Delegate to mail provider (e.g., gt mail)
  mol             Molecule commands (work templates)
  orphans         Identify orphaned issues (referenced in commits but still open)
  ready           Show ready work (open, no active blockers)
  rename          Rename an issue ID
  ship            Publish a capability for cross-project dependencies
  slot            Manage agent bead slots
  undefer         Undefer one or more issues (restore to open)
  version         Print version information

Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
  -h, --help                      help for bd
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output
  -V, --version                   Print version information

Use "bd [command] --help" for more information about a command.

```

#### bd agent --help

```
Manage state on agent beads for ZFC-compliant state reporting.

Agent beads (labeled gt:agent) can self-report their state using these commands.
This enables the Witness and other monitoring systems to track agent health.

States:
  idle      - Agent is waiting for work
  spawning  - Agent is starting up
  running   - Agent is executing (general)
  working   - Agent is actively working on a task
  stuck     - Agent is blocked and needs help
  done      - Agent completed its current work
  stopped   - Agent has cleanly shut down
  dead      - Agent died without clean shutdown (set by Witness via timeout)

Examples:
  bd agent state gt-emma running     # Set emma's state to running
  bd agent heartbeat gt-emma         # Update emma's last_activity timestamp
  bd agent show gt-emma              # Show emma's agent details

Usage:
  bd agent [command]

Available Commands:
  backfill-labels Backfill role_type/rig labels on existing agent beads
  heartbeat       Update agent last_activity timestamp
  show            Show agent bead details
  state           Set agent state

Flags:
  -h, --help   help for agent

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

Use "bd agent [command] --help" for more information about a command.

```

##### bd agent state --help

```
Set the state of an agent bead.

This updates both the agent_state field and the last_activity timestamp.
Use this for ZFC-compliant state reporting.

Valid states: idle, spawning, running, working, stuck, done, stopped, dead

Examples:
  bd agent state gt-emma running   # Set state to running
  bd agent state gt-mayor idle     # Set state to idle

Usage:
  bd agent state <agent> <state> [flags]

Flags:
  -h, --help   help for state

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

```

#### bd audit --help

```
Audit log entries are appended to .beads/interactions.jsonl.

Each line is one event. This file is intended to be versioned in git and used for:
- auditing ("why did the agent do that?")
- dataset generation (SFT/RL fine-tuning)

Entries are append-only. Labeling creates a new "label" entry that references a parent entry.

Usage:
  bd audit [command]

Available Commands:
  label       Append a label entry referencing an existing interaction
  record      Append an audit interaction entry

Flags:
  -h, --help   help for audit

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

Use "bd audit [command] --help" for more information about a command.

```

#### bd completion --help

```
Generate the autocompletion script for bd for the specified shell.
See each sub-command's help for details on how to use the generated script.


Usage:
  bd completion [command]

Available Commands:
  bash        Generate the autocompletion script for bash
  fish        Generate the autocompletion script for fish
  powershell  Generate the autocompletion script for powershell
  zsh         Generate the autocompletion script for zsh

Flags:
  -h, --help   help for completion

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

Use "bd completion [command] --help" for more information about a command.

```

#### bd defer --help

```
Defer issues to put them on ice for later.

Deferred issues are deliberately set aside - not blocked by anything specific,
just postponed for future consideration. Unlike blocked issues, there's no
dependency keeping them from being worked. Unlike closed issues, they will
be revisited.

Deferred issues don't show in 'bd ready' but remain visible in 'bd list'.

Examples:
  bd defer bd-abc                  # Defer a single issue (status-based)
  bd defer bd-abc --until=tomorrow # Defer until specific time
  bd defer bd-abc bd-def           # Defer multiple issues

Usage:
  bd defer [id...] [flags]

Flags:
  -h, --help           help for defer
      --until string   Defer until specific time (e.g., +1h, tomorrow, next monday)

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

```

#### bd formula --help

```
Manage workflow formulas - the source layer for molecule templates.

Formulas are YAML/JSON files that define workflows with composition rules.
They are "cooked" into proto beads which can then be poured or wisped.

The Rig → Cook → Run lifecycle:
  - Rig: Compose formulas (extends, compose)
  - Cook: Transform to proto (bd cook expands macros, applies aspects)
  - Run: Agents execute poured mols or wisps

Search paths (in order):
  1. .beads/formulas/ (project)
  2. ~/.beads/formulas/ (user)
  3. $GT_ROOT/.beads/formulas/ (orchestrator, if GT_ROOT set)

Commands:
  list   List available formulas from all search paths
  show   Show formula details, steps, and composition rules

Usage:
  bd formula [command]

Available Commands:
  convert     Convert formula from JSON to TOML
  list        List available formulas
  show        Show formula details

Flags:
  -h, --help   help for formula

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

Use "bd formula [command] --help" for more information about a command.

```

##### bd formula convert --help

```
Convert formula files from JSON to TOML format.

TOML format provides better ergonomics:
  - Multi-line strings without \n escaping
  - Human-readable diffs
  - Comments allowed

The convert command reads a .formula.json file and outputs .formula.toml.
The original JSON file is preserved (use --delete to remove it).

Examples:
  bd formula convert shiny              # Convert shiny.formula.json to .toml
  bd formula convert ./my.formula.json  # Convert specific file
  bd formula convert --all              # Convert all JSON formulas
  bd formula convert shiny --delete     # Convert and remove JSON file
  bd formula convert shiny --stdout     # Print TOML to stdout

Usage:
  bd formula convert <formula-name|path> [--all] [flags]

Flags:
      --all      Convert all JSON formulas
      --delete   Delete JSON file after conversion
  -h, --help     help for convert
      --stdout   Print TOML to stdout instead of file

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

```

#### bd gitlab --help

```
Commands for syncing issues between beads and GitLab.

Configuration can be set via 'bd config' or environment variables:
  gitlab.url / GITLAB_URL         - GitLab instance URL
  gitlab.token / GITLAB_TOKEN     - Personal access token
  gitlab.project_id / GITLAB_PROJECT_ID - Project ID or path

Usage:
  bd gitlab [command]

Available Commands:
  projects    List accessible GitLab projects
  status      Show GitLab sync status
  sync        Sync issues with GitLab

Flags:
  -h, --help   help for gitlab

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

Use "bd gitlab [command] --help" for more information about a command.

```

#### bd help --help

```
Help provides help for any command in the application.
Simply type bd help [path to command] for full details.

Usage:
  bd help [command] [flags]

Flags:
      --all          Show help for all commands in a single document
      --doc string   Generate markdown docs for a single command (use - for stdout)
  -h, --help         help for help
      --list         List all available commands

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

```

#### bd mol --help

```
Manage molecules - work templates for agent workflows.

Protos are template epics with the "template" label. They define a DAG of work
that can be spawned to create real issues (molecules).

The molecule metaphor:
  - A proto is an uninstantiated template (reusable work pattern)
  - Spawning creates a molecule (real issues) from the proto
  - Variables ({{key}}) are substituted during spawning
  - Bonding combines protos or molecules into compounds
  - Distilling extracts a proto from an ad-hoc epic

Commands:
  show       Show proto/molecule structure and variables
  pour       Instantiate proto as persistent mol (liquid phase)
  wisp       Instantiate proto as ephemeral wisp (vapor phase)
  bond       Polymorphic combine: proto+proto, proto+mol, mol+mol
  squash     Condense molecule to digest
  burn       Discard wisp
  distill    Extract proto from ad-hoc epic

Use "bd formula list" to list available formulas.

Usage:
  bd mol [command]

Aliases:
  mol, protomolecule

Available Commands:
  bond          Bond two protos or molecules together
  burn          Delete a molecule without creating a digest
  current       Show current position in molecule workflow
  distill       Extract a formula from an existing epic
  last-activity Show last activity timestamp for a molecule
  pour          Instantiate a proto as a persistent mol (solid -> liquid)
  progress      Show molecule progress summary
  ready         Find molecules ready for gate-resume dispatch
  seed          Verify formula accessibility or seed patrol formulas
  show          Show molecule details
  squash        Compress molecule execution into a digest
  stale         Detect complete-but-unclosed molecules
  wisp          Create or manage wisps (ephemeral molecules)

Flags:
  -h, --help   help for mol

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

Use "bd mol [command] --help" for more information about a command.

```

#### bd orphans --help

```
Identify orphaned issues - issues that are referenced in commit messages but remain open or in_progress in the database.

This helps identify work that has been implemented but not formally closed.

Examples:
  bd orphans              # Show orphaned issues
  bd orphans --json       # Machine-readable output
  bd orphans --details    # Show full commit information
  bd orphans --fix        # Close orphaned issues with confirmation

Usage:
  bd orphans [flags]

Flags:
      --details   Show full commit information
  -f, --fix       Close orphaned issues with confirmation
  -h, --help      help for orphans

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

```

#### bd undefer --help

```
Undefer issues to restore them to open status.

This brings issues back from the icebox so they can be worked on again.
Issues will appear in 'bd ready' if they have no blockers.

Examples:
  bd undefer bd-abc        # Undefer a single issue
  bd undefer bd-abc bd-def # Undefer multiple issues

Usage:
  bd undefer [id...] [flags]

Flags:
  -h, --help   help for undefer

Global Flags:
      --actor string              Actor name for audit trail (default: $BD_ACTOR, git user.name, $USER)
      --db string                 Database path (default: auto-discover .beads/*.db)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then. SIGTERM/SIGHUP flush pending batch commits. Default: off. Override via config key dolt.auto-commit
      --json                      Output in JSON format
      --profile                   Generate CPU profile for performance analysis
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables auto-sync
  -v, --verbose                   Enable verbose/debug output

```

---

## OpenSpec Commands (openspec)

### openspec --help

```
Usage: openspec [options] [command]

AI-native system for spec-driven development

Options:
  -V, --version                      output the version number
  --no-color                         Disable color output
  -h, --help                         display help for command

Commands:
  init [options] [path]              Initialize OpenSpec in your project
  update [options] [path]            Update OpenSpec instruction files
  list [options]                     List items (changes by default). Use
                                     --specs to list specs.
  view                               Display an interactive dashboard of specs
                                     and changes
  change                             Manage OpenSpec change proposals
  archive [options] [change-name]    Archive a completed change and update main
                                     specs
  spec                               Manage and view OpenSpec specifications
  config [options]                   View and modify global OpenSpec
                                     configuration
  schema                             Manage workflow schemas [experimental]
  validate [options] [item-name]     Validate changes and specs
  show [options] [item-name]         Show a change or spec
  feedback [options] <message>       Submit feedback about OpenSpec
  completion                         Manage shell completions for OpenSpec CLI
  status [options]                   Display artifact completion status for a
                                     change
  instructions [options] [artifact]  Output enriched instructions for creating
                                     an artifact or applying tasks
  templates [options]                Show resolved template paths for all
                                     artifacts in a schema
  schemas [options]                  List available workflow schemas with
                                     descriptions
  new                                Create new items
  help [command]                     display help for command

```

#### openspec init --help

```
Usage: openspec init [options] [path]

Initialize OpenSpec in your project

Options:
  --tools <tools>      Configure AI tools non-interactively. Use "all", "none",
                       or a comma-separated list of: amazon-q, antigravity,
                       auggie, claude, cline, codex, codebuddy, continue,
                       costrict, crush, cursor, factory, gemini, github-copilot,
                       iflow, kilocode, kiro, opencode, pi, qoder, qwen,
                       roocode, trae, windsurf
  --force              Auto-cleanup legacy files without prompting
  --profile <profile>  Override global config profile (core or custom)
  -h, --help           display help for command

```

#### openspec list --help

```
Usage: openspec list [options]

List items (changes by default). Use --specs to list specs.

Options:
  --specs         List specs instead of changes
  --changes       List changes explicitly (default)
  --sort <order>  Sort order: "recent" (default) or "name" (default: "recent")
  --json          Output as JSON (for programmatic use)
  -h, --help      display help for command

```

#### openspec update --help

```
Usage: openspec update [options] [path]

Update OpenSpec instruction files

Options:
  --force     Force update even when tools are up to date
  -h, --help  display help for command

```

---
