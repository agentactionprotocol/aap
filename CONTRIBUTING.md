# Contributing to AAP

Thank you for considering contributing to the Agent Action Protocol. This is an early-stage project and every form of input is valuable — from spec critiques to reference implementations to typo fixes.

## How to Contribute

### Spec Feedback

The most impactful contributions right now are **feedback on the spec itself**. If something feels wrong, overengineered, underspecified, or missing entirely, say so.

1. **Open an issue** describing what you think should change and why
2. Discussion happens in the issue
3. If we reach rough consensus, someone (you or a maintainer) opens a PR

Don't feel like you need to have a complete solution to open an issue. "This section doesn't make sense" or "What about X?" are perfectly valid contributions.

### Code Contributions

For reference implementations, adapters, and tooling:

1. Fork the repo
2. Create a branch (`git checkout -b my-change`)
3. Make your changes
4. Submit a PR with a clear description of what and why

#### Guidelines

- Follow existing patterns in the codebase
- If adding an example, include AAP manifest files (`action.aap.yaml`, `contract.aap.yaml`, etc.)
- Keep PRs focused — one concern per PR
- Tests are appreciated but not required at this stage

### New Examples

Want to build an AAP adapter for a different runtime (Claude Code, Vercel AI SDK, LangChain, etc.)? That's hugely valuable. Drop it in `examples/` or `packages/` depending on whether it's a standalone example or a reusable library.

## What's Needed Most

In rough priority order:

1. **Spec feedback** — What's missing? What's wrong? What's overengineered?
2. **Runtime adapters** — Implementations for Claude, OpenAI, Vercel AI SDK, LangChain, etc.
3. **JSON Schema definitions** — Formal schemas for all AAP manifest types
4. **Registry design** — API specification for action discovery and distribution
5. **Test suites** — Conformance tests for runtime adapters
6. **Security review** — Threat modeling for the permission and auth models

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Questions?

Open an issue. There are no stupid questions at this stage.
