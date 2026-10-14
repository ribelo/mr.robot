# 07: Robot settings labels: plugin tools, Hosts per host, web group; Host sentence in the prompt

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-5g3w, ux-q8o6, ux-qm6u, ux-ywxa, ux-czg2

**What to build:** In a Robot's Advanced settings the Connections section says "Plugin tools: one item per connected account" and each item is labelled with its plugin and account ("Google · r.krzywaznia@gmail.com", "Discord bot · Mr. Robot"); the Hosts section is grouped under one heading per Host with its online/offline state and the facets files, shell and browser under it; the web group reads "Fetch pages by address (web_fetch, free; searching is Exa)". my_capabilities and the runtime section carry the same labels. The tool-rules section of the platform prompt tells a Robot that Host online state is in its runtime section and in my_capabilities and that it does not probe a Host with a command.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Capability items carry the plugin title and the host grouping data; my_capabilities and the prompt preview show the same labels (workerd test)
- [ ] Settings sections render as described (component test)
- [ ] Host sentence present in the prompt preview
