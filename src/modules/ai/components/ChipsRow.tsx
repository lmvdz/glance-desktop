import { CodeIcon, HashtagIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { ComposerTrayChip } from "@/components/composer/ComposerTrayChip";
import type { FileAttachment } from "../lib/composer";
import type { Snippet } from "../lib/snippets";

type CommandChip = { name: string; label: string; icon: typeof HashtagIcon };

type Props = {
  files: FileAttachment[];
  onRemoveFile: (id: string) => void;
  snippets: Snippet[];
  onRemoveSnippet: (id: string) => void;
  commands: CommandChip[];
  onRemoveCommand: (name: string) => void;
};

/** Attachment chips for the AI composer's chip TRAY (rendered below the input by
 *  ComposerShell — a plain <textarea> can't host t3's inline chips). Styled with the
 *  ported t3 chip classes (composerInlineChip.ts), not the general-purpose `Chip`
 *  component (which stays as-is elsewhere, e.g. the terminal's cwd/branch badges). */
export function ChipsRow({
  files,
  onRemoveFile,
  snippets,
  onRemoveSnippet,
  commands,
  onRemoveCommand,
}: Props) {
  const hasAttachments =
    files.length > 0 || snippets.length > 0 || commands.length > 0;
  if (!hasAttachments) return null;
  return (
    <>
      {commands.map((cmd) => (
        <ComposerTrayChip
          key={`cmd-${cmd.name}`}
          icon={cmd.icon}
          title={cmd.label}
          onRemove={() => onRemoveCommand(cmd.name)}
          removeLabel="Remove command"
        >
          #{cmd.name}
        </ComposerTrayChip>
      ))}
      {snippets.map((s) => (
        <ComposerTrayChip
          key={`snip-${s.id}`}
          icon={HashtagIcon}
          title={s.description || s.name}
          onRemove={() => onRemoveSnippet(s.id)}
          removeLabel="Remove snippet"
        >
          {s.handle}
        </ComposerTrayChip>
      ))}
      {files.map((f) => (
        <ComposerTrayChip
          key={f.id}
          iconNode={fileIcon(f)}
          onRemove={() => onRemoveFile(f.id)}
        >
          {f.name}
          {f.kind === "selection" && f.text ? (
            <span className="ml-1 opacity-60">· {selLineCount(f.text)}L</span>
          ) : null}
        </ComposerTrayChip>
      ))}
    </>
  );
}

function fileIcon(f: FileAttachment): ReactNode {
  if (f.kind === "image" && f.url) {
    return <img src={f.url} alt="" className="size-4 shrink-0 rounded object-cover" />;
  }
  if (f.kind === "selection") {
    return (
      <HugeiconsIcon
        icon={f.source === "editor" ? CodeIcon : TerminalIcon}
        size={11}
        strokeWidth={1.75}
        className="shrink-0 opacity-80"
      />
    );
  }
  return (
    <span className="shrink-0 font-mono text-[10px] opacity-70">
      {extOf(f.name)}
    </span>
  );
}

function selLineCount(text: string): number {
  if (!text) return 0;
  const trimmed = text.replace(/\n+$/, "");
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "FILE" : name.slice(i + 1).toUpperCase();
}
