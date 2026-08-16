# Changelog

## [Unreleased]

### Changed
- Live style activation, switching, and `off` now use hidden persistent control messages instead of changing the per-turn system prompt, preserving the stable system-prompt cache prefix.
- Session resume restores the latest persisted style selection, and the active control is re-emitted once after compaction or `/clear`.
- A request-local context guard preserves the active style when automatic compaction happens after the user-turn hook or during a tool loop, at a stable position across continuations.
- Extension loading and the `/style` hint poller now use APIs shared by current Pi and OMP.
- Session-only style and `off` selections are recorded immediately, so navigation or reload before the next prompt cannot discard them.

## [0.2.1] - 2026-08-08

### Added
- Persistent flag hint while composing `/style`: a dim widget below the input shows `--save` (user default, `--global` alias) and `--project` (project default) once the command is detected, and clears when it is not.
- `/style` tab-completion items advertise the persist flags as a dim hint in the dropdown.

## [0.2.0] - 2026-08-07

### Added
- Bundled `ste` style: ASD-STE100 Simplified Technical English (strict for procedures/errors, STE-flavored for prose).
- Bundled `eli5` style: casual "explain like I'm 5" mode (adapted from Lydia Hallie).

## [0.1.0] - 2026-08-07

### Added
- Append-only system-prompt styles with a live `/style` switcher (switches mid-session, no restart).
- Config default (user/project) plus session override; `--save` (user) / `--project` (git-tracked) persistence, personal-by-default.
- `/style off` (alias `none`) clears the active style for the session; `off --save` / `off --project` also clears the saved default.
- Tab-completion of style names (and `off`) for the `/style` command, with descriptions.
- Bundled starter styles: concise, explanatory, teacher, reviewer, diagrams-first.
- Status-line indicator of the active style.
