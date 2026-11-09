# Smartv2 Agent Project Guide

This folder contains the working direction for the Smartv2 React + Firebase platform. It is written so an AI coding agent can understand the project goals, architecture, implementation order, and rules before generating or editing code.

## How an agent should use these files

Read these files in this order before making changes:

1. `01-project-vision.md`
2. `02-setup-and-stack.md`
3. `03-architecture-rules.md`
4. `04-implementation-roadmap.md`
5. `05-page-build-pattern.md`
6. `06-agentic-support-standard.md`
7. `07-ui-ux-mobile-theme-language.md`
8. `08-firebase-services-permissions.md`
9. `09-definition-of-done.md`
10. `10-recovery-status.md`
11. `11-agent-orchestration.md`
12. `12-whatsapp-support-roadmap.md` when changing the WhatsApp channel
13. `13-awareness-training-module.md` when changing awareness training, ESG reporting, client revenue or the client funder report (client modules that must stay off for other companies)

## Recovery workflow

This repository was reconstructed from partial files. Before starting a new implementation batch, read `10-recovery-status.md`. After each batch, update its current-state checklist and change log so the next agent can distinguish working code, salvaged fragments, and files that still need to be rebuilt.

## Non-negotiable project direction

Smartv2 must be built as a production-ready React + Firebase platform from day one. The system must be responsive, theme-aware, language-aware, role-aware, and agent-ready across every page.

The agent must avoid quick hacks that create future cleanup work. Every page should follow the shared architecture: typed models, services, route registry, permissions, responsive UI, translation keys, and registered page context for the assistant.
