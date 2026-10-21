export const WORKSPACES = `# Workspaces

A Workspace is a Host and a root folder on it where a Robot works, as in DeepSeek Harness: the folder of a git repository on one of the owner's computers. A Robot has none by default. The owner chooses it in the Robot's settings (a computer and a folder, through a folder picker), in the Add form of a definition that needs a computer, or Mr. Robot sets it with robot_settings_set. The platform checks it on the Host: a folder, reached through no link, inside a git repository. It keeps the repository root above it. Several Robots may share one root. The Box is not a Workspace. Your Files (on \"files\") stay in R2, as before.

## Working there

Name the Workspace with on \"workspace\". A relative path and a command there start in your current directory. working_directory tells you where you are and moves you within the repository (cd); the platform keeps it for your next Turns, and a Subagent has its own, starting in yours. Naming the Host by its name still starts in your own directory there, ~/mr-robot/<you>/. The calls follow the files and shell facets of the Workspace's Host, with their modes. In workspace-write mode you may change the root and the repository's .git. On macOS and Windows that extra root makes workspace-write fail closed; full mode works there.

The runtime section of your prompt has one Workspace line: the Host, the root, the repository and the shell. The current directory is not in the prompt, so a cd does not change it.

## Instructions and skills

The repository's instructions reach you as their own message after your memory, never in the system prompt: the OS user's global AGENTS.md (~/.dsh and ~/.agents), then every AGENTS.md, CLAUDE.md and .local.md file from the repository root down to your current directory, as DSH reads them, within 65,536 bytes. A read or a write in a deeper folder adds that folder's files. A cd gives you the whole chain again. A changed file comes with its new text and a removed one with a notice, at your next Turn or step. Nothing outside the repository is read but the two global files, and no link out of it is followed.

The Host's skills join your catalog: the OS user's (~/.agents/skills, ~/.dsh/skills) rank with the Space library, the repository's (.agents/skills) with your local skills. A platform skill always wins its name. The winner notes the skill it shadows. Load the platform skill coding before you change code.

## Files on a Host

read gives a file's size, line endings and content hash. A write or an edit of a file you read is refused when the file changed since (another Robot, or a person, wrote it): read it again. edit matches and writes in the file's own line endings. A write sent again after a lost connection is not done twice. One write carries at most 1 MiB to a computer: a bigger file goes to your Files and moves with copy. A read returns at most 2,000 lines and 50 KiB at once; a file over 10 MB is not read.

## Worktrees

create_worktree makes your own branch and checkout under <repository>/.agents/worktrees/<you>, from the current commit, and moves you there. From then on you may change only your worktree and the repository's .git, not the main working tree. A worktree holds committed content only: no untracked or ignored files, no submodules, no fetch, no installed dependencies. Install what the repository needs there yourself. One worktree per Robot; a Subagent cannot make one. Leaving it keeps the branch and the files.

## Language servers

lsp asks the language server of your Workspace: goToDefinition, findReferences, goToImplementation and hover, on \"workspace\" only. The servers are the ones installed on that computer (typescript-language-server, pyright, rust-analyzer, gopls, ocamllsp, nil, or the owner's lsp.yaml). They start on the first query, with the Workspace root (or your worktree) as their root. They stop when the Workspace changes and after 30 minutes without a query. They run as the OS user, without the sandbox.

## The owner's view

Robots with a Workspace show Work details Code by default: every call in full in the Conversation, edits as diffs, reads as fragments, commands with their output and exit code. The owner's Workspace panel shows the Host, the root, the worktree, your current directory, the files of the checkout and git's status and last twenty commits, read without running the repository's programs. The Fleet shows where each Robot works.

## Git and credentials

git runs as the OS user, with that user's keys, SSH agent and credential helpers: you commit as that user. Mr. Robot gives git no credential of its own. Names that look like credentials are kept out of a command's environment unless the Host config allows them.
`
