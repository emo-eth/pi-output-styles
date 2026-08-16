# pi-output-styles

[![CI](https://github.com/emo-eth/pi-output-styles/actions/workflows/ci.yml/badge.svg)](https://github.com/emo-eth/pi-output-styles/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pi-output-styles.svg)](./LICENSE)

Named, swappable, **cache-preserving** output styles for [Oh My Pi (OMP)](https://pi.dev) and Pi — with a live `/style` switcher. Unlike Claude Code's output styles (which need `/clear` to switch), styles here apply and switch **live, mid-session** without changing the effective system prompt.

This is a cache-preserving fork of [LoneExile/pi-output-styles](https://github.com/LoneExile/pi-output-styles).

![/style demo](https://github.com/emo-eth/pi-output-styles/raw/main/assets/demo.gif)

## Install

```bash
omp plugin install github:emo-eth/pi-output-styles
```

Install this fork from GitHub; the upstream npm release does not include the cache-preserving control-message implementation.

## Use

- `/style` — show the active style and list available ones.
- `/style <name>` — activate a style for this session.
- `/style <name> --save` — also save it as your personal (user) default.
- `/style <name> --project` — save it as the project default (committed with the repo).
- `/style off` — clear the active style for this session (overrides any saved default). `none` is an alias; `off --save` / `off --project` also clears the saved default.
- While composing `/style`, a hint line below the input shows the available flags (`--save` / `--project`).

The effective system prompt is left unchanged. When a style becomes active, changes, or turns off, the extension adds a hidden model-visible control message after the submitted prompt. OMP/Pi persists that message in session history, so an unchanged style body is not repeated every turn. Later switches append a superseding control and preserve the existing provider-cache prefix.

The session selection is recorded immediately, so switching sessions or navigating the tree before the next prompt does not discard a confirmed `/style` change. Session resume restores that selection. After compaction or `/clear`, the extension re-emits the current control once; a final pre-provider context guard also covers automatic compaction and tool-loop continuations that happen after the user-turn hook. The guard keeps a stable position across continuations, preserving locally kept history, provider-owned remote compaction, explicit context resets, and the provider-cache prefix without repeating the body on ordinary turns. The status line shows the active style.

## Bundled styles

`concise` · `explanatory` · `teacher` · `reviewer` · `diagrams-first` · `ste` · `eli5`.

`ste` writes in [ASD-STE100](https://asd-ste100.org) Simplified Technical English, adapted from [Ege Chelebi's ste-writing skill](https://www.chele.bi/videos/the-cure-for-ai-slop/kit/ste-writing-skill).

`eli5` is [Lydia Hallie's ELI5 style](https://x.com/lydiahallie/status/2080378470111256907).

## Custom styles

Drop a Markdown file in either location (filename = style name unless overridden):

- Project: `<repo>/.omp/output-styles/<name>.md`
- Personal: `~/.omp/agent/output-styles/<name>.md`

```markdown
---
name: teacher
description: Teach as you go
---
Act as a patient teacher. Explain the concept before applying it.
```

The body is delivered in the hidden style control message. Precedence — **definitions**: project > user > bundled; **which style is active**: session `/style` > user default > project default.

## Config

- `PI_OUTPUT_STYLES_HOME` — override the user config base (default `~/.omp/agent`).
- User default (written by `--save`): `~/.omp/agent/pi-output-styles.json` (base overridable via `PI_OUTPUT_STYLES_HOME`).
- Project default (written by `--project`, git-tracked): `<repo>/.omp/pi-output-styles.json`.

## Develop

```bash
bun install
bun test
bun run typecheck
```
