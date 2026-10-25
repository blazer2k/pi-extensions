# @blazer2k/pi-personality

Switchable communication styles for [pi](https://pi.dev), inspired by Codex CLI's `/personality` command.

**Current version:** 0.2.2

## Why This Matters

Personality shapes how pi communicates with you: word choice, warmth, how eagerly it explains things, and how it raises concerns. It is intended to steer tone and collaboration posture, not task execution.

The personality text is wrapped in a scoping instruction telling the model to apply it only to communication style. In practice, the containment is not perfect — evaluation runs show that different personalities can produce different tool-calling patterns, different architectural choices, and different levels of verbosity. The effect varies by model and prompt. Treat personality as a dial that primarily affects communication style but may have secondary effects on how the agent approaches problems.

## Overview

This extension adds a `/personality` command that lets you pick a communication style for pi. The chosen personality is appended to the system prompt.

### Included Personalities

| Personality   | Style                                                                             | Origin                |
| ------------- | --------------------------------------------------------------------------------- | --------------------- |
| **None**      | No personality prompt. Raw model behavior.                                        | —                     |
| **Pragmatic** | Concise, task-focused, direct. No fluff, no cheerleading.                         | Copied from Codex CLI |
| **Friendly**  | Warm, encouraging, collaborative. Uses "we" and "let's".                          | Copied from Codex CLI |
| **Teacher**   | Builds durable understanding while getting work done. Teaches at decision points. | Custom                |
| **Casual**    | Informal, natural, and easygoing. Keeps collaboration conversational.             | Custom                |

### Custom Personalities

Drop `.md` files with YAML frontmatter into `~/.pi/agent/personalities/`:

```markdown
---
name: MyStyle
description: A custom communication style
---

Your system prompt text here...
```

Custom personalities with the same name as a builtin override it. Others appear alongside builtins in the picker.

## Installation

```bash
pi install npm:@blazer2k/pi-personality
```

Or install locally for development:

```bash
git clone https://github.com/blazer2k/pi-extensions.git
cd pi-extensions
npm install
pi -e ./packages/pi-personality/src/index.ts
```

## Usage

Type `/personality` in pi to open the style picker. Select a personality and it takes effect immediately for the current session.

## Caveats

- **Mutates the system prompt.** The personality text is appended to the existing system prompt via the `before_agent_start` hook. This adds ~500-800 tokens to the context window (or zero with **None**).
- **File changes require reload.** If you edit a personality `.md` file while pi is running, the extension will not pick up the changes until you `/reload` or switch to a different personality and back.
- **Beware of untrusted prompts.** Custom personalities are injected directly into the system prompt. If you install personalities from unknown sources, review their content first; a malicious prompt could steer the agent's behavior in unintended ways.
- **Personality can affect more than tone.** The scoping instruction is not fully enforced — personality may influence tool-calling patterns, architectural decisions, and verbosity beyond just communication style.

## Persistence

The active personality is saved to `~/.pi/agent/personality-state.json` and restored on next session.

## License

MIT
