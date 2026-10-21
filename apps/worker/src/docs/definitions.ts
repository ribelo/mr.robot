export const DEFINITIONS = `# Definitions and the Marketplace

A definition is a Robot as files, so that another person can add a Robot like it. It is a snapshot: nothing links it to the Robot it came from.

## What a definition holds

A definition is one directory, robots/<slug>/ in the Space's library repository:
- SOUL.md, AGENTS.md, MEMORY.md: the persona and the memory, with nothing about its first owner.
- skills/: its local skills.
- README.md: a title, one paragraph, and "The interview will ask:", what the new owner must tell.
- tasks.yaml: its recurring and scheduled Tasks, each with enabled: false.
- grants.yaml: what it needs: tool groups, connectors by kind, logins by site, Host facets, each with a level.

The platform writes tasks.yaml and grants.yaml and reads them with a strict schema; people read them and never edit them. grants.yaml never names a Connection or a login entry of anyone.

## Save as definition

The owner saves a Robot as a definition from its settings. The platform copies the files to definition-draft/<slug>/ in the Robot's Workspace. Then the Robot gets one bounded step: take out of the copies everything about its owner and write README.md. Change nothing else, and do not reply. The platform writes the two YAML files from the Robot's Tasks and Grants, and the definition enters the Space's library. A definition the Space admin saves is in the Marketplace at once; another Member's stays his until the admin publishes it.

## The library repository

The library sync reads every robots/<slug>/ directory of the repository, as it reads skills. A definition from the repository wins over a saved one of the same name. There is no write to Git: Download definition gives the directory as a tar.gz, and the admin commits it to robots/<slug>/ by hand; the next sync reads it back.

## The Marketplace

The Marketplace lists the definitions a Member sees: the title, the paragraph, what it needs (marked when the Member has it), who made it and when. Add makes a new Robot of the Member, in setup, with the definition's files:
- The setup interview asks only what belongs to the person.
- setup_complete proposes the Grants of grants.yaml, met from the owner's Connections, logins and Hosts. What nothing meets comes back as notMet: tell your owner.
- After approval, its Tasks are created and do not run yet. Ask your owner once which of them to enable.

## Grok Bot templates

A Member can import a Grok Bot marketplace page. The result is a brief, not a working Robot: Grok Bot keeps the recipe closed. Its README says "Imported summary". The description is a first draft of SOUL.md, the memories are Facts, each skill is a one-line stub, each routine is a Task with no moment, and each integration without a Connector is a note.
`
