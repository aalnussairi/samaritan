import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const EXTREMELY_IMPORTANT_MARKER = "<EXTREMELY_IMPORTANT>";
const BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for omp";

const skillsDir = new URL("../skills", import.meta.url).pathname;
const bootstrapSkillPath = `${skillsDir}/using-superpowers/SKILL.md`;

let cachedBootstrap: string | null | undefined;

export default function superpowersExtension(pi: ExtensionAPI) {
  let injectBootstrap = true;

  pi.on("session_start", async () => {
    injectBootstrap = true;
  });

  pi.on("session_compact", async () => {
    injectBootstrap = true;
  });

  pi.on("agent_end", async () => {
    injectBootstrap = false;
  });

  pi.on("context", async (event) => {
    if (!injectBootstrap) {
      return;
    }
    if (event.messages.some(messageContainsBootstrap)) {
      return;
    }

    const bootstrap = await getBootstrapContent();
    if (!bootstrap) {
      return;
    }

    const bootstrapMessage = {
      role: "user" as const,
      content: [{ type: "text" as const, text: bootstrap }],
      timestamp: Date.now(),
    };

    const insertAt = firstNonCompactionSummaryIndex(event.messages);
    return {
      messages: [
        ...event.messages.slice(0, insertAt),
        bootstrapMessage,
        ...event.messages.slice(insertAt),
      ],
    };
  });
}

async function getBootstrapContent(): Promise<string | null> {
  if (cachedBootstrap !== undefined) {
    return cachedBootstrap;
  }

  try {
    const file = Bun.file(bootstrapSkillPath);
    if (!(await file.exists())) {
      cachedBootstrap = null;
      return null;
    }
    const skillContent = await file.text();
    const body = stripFrontmatter(skillContent);
    cachedBootstrap = `${EXTREMELY_IMPORTANT_MARKER}
${BOOTSTRAP_MARKER}

You have superpowers.

The using-superpowers skill content is included below and is already loaded for this session. Follow it now. Do not try to load using-superpowers again.

${body}

${ompToolMapping()}
</EXTREMELY_IMPORTANT>`;
    return cachedBootstrap;
  } catch {
    cachedBootstrap = null;
    return null;
  }
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : content).trim();
}

function ompToolMapping(): string {
  return `## Oh My Pi tool mapping

Skills speak in actions ("dispatch a subagent", "create a todo", "read a file"). On Oh My Pi these resolve to the tools below.

| Action skills request | Oh My Pi equivalent |
| --- | --- |
| Invoke a skill | Use \`/skill:<name>\` or read the skill via \`read skill://<name>\`. Skills are auto-discovered from \`.omp/skills/\` and show in the system prompt. On this harness, reading \`SKILL.md\` *is* the skill-loading mechanism — do it before acting when a skill applies. |
| Read a file | \`read\` |
| Create a file | \`write\` |
| Edit a file | \`edit\` |
| Run a shell command | \`bash\` |
| Search file contents | \`search\` (regex-based) |
| Find files by name | \`find\` (glob-based) |
| List files and subdirectories | \`read\` on a directory path, or \`find\` |
| Fetch a URL | \`read\` (supports URLs with reader-mode extraction) |
| Search the web | \`web_search\` |
| Code intelligence (definitions, references, hover, rename) | \`lsp\` |
| AST-aware search | \`ast_grep\` |
| AST-aware codemods | \`ast_edit\` |
| Dispatch a subagent (\`Subagent (general-purpose):\` template) | \`task\` tool — dispatches parallel subagents. Use \`task\` with agent_type \`"task"\` for general-purpose work, \`"explore"\` for read-only investigation. |
| Multiple parallel dispatches | Multiple tasks in one \`task\` call's \`tasks\` array |
| Task tracking ("create a todo", "mark complete") | \`todo\` tool — phased task list with \`init\`, \`start\`, \`done\`, \`drop\`, \`append\` ops |
| Ask the human partner | \`ask\` |
| Browser interaction | \`browser\` (Chromium automation) |
| Debugging | \`debug\` (DAP: launch, attach, breakpoints, stepping, inspection) |
| Code evaluation | \`eval\` (Python IPython kernel or persistent JS VM) |
| Image generation | \`generate_image\` |

## Skills

Oh My Pi discovers skills from \`.omp/skills/\`, installed plugin packages, and configured \`skills.customDirectories\`. Skills appear in the system prompt with their name and description. The \`/skill:<name>\` slash command loads a skill's full content into the session. \`read skill://<name>\` reads the \`SKILL.md\` file, and \`read skill://<name>/path/to/asset\` reaches supporting files inside the skill directory.

Oh My Pi does **not** expose a \`Skill\` tool. When a Superpowers instruction says to invoke a skill, load it with \`read skill://<name>\` before responding. The rule "never read skill files manually" means "don't bypass your platform's skill-loading mechanism" — and on Oh My Pi, reading \`SKILL.md\` through the skill:// protocol *is* that mechanism.

## Subagents

Oh My Pi ships \`task\` as its subagent tool. It supports parallel dispatch with configurable agent types:
- \`"task"\` — full-capability subagent (read, write, edit, bash, etc.)
- \`"explore"\` — read-only codebase scout
- \`"quick_task"\` — low-reasoning agent for mechanical updates
- \`"oracle"\` — senior engineer for debugging and architecture
- \`"reviewer"\` — code review specialist
- \`"plan"\` — software architect for multi-file design
- \`"designer"\` — UI/UX specialist
- \`"librarian"\` — external library researcher

When a skill dispatches with a template (e.g. \`implementer-prompt.md\`), fill the template and pass it as the subagent's assignment. For parallel independent work, include multiple tasks in one \`task\` call.

## Task lists

Oh My Pi ships \`todo\` as its task-tracking tool with phased lists and operations: \`init\`, \`start\`, \`done\`, \`drop\`, \`append\`, \`note\`, \`rm\`. When a Superpowers skill says to create a todo list or mark items complete, use the \`todo\` tool. Older Superpowers docs may reference \`TodoWrite\`; treat that as the \`todo\` tool above — use \`init\` to create the list and \`done\` to mark completion.`;
}

function messageContainsBootstrap(message: unknown): boolean {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.includes(BOOTSTRAP_MARKER);
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string" &&
      (part as { text: string }).text.includes(BOOTSTRAP_MARKER)
  );
}

function firstNonCompactionSummaryIndex(messages: unknown[]): number {
  let index = 0;
  while (
    (messages[index] as { role?: unknown } | undefined)?.role ===
    "compactionSummary"
  ) {
    index += 1;
  }
  return index;
}
