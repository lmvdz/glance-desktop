// Lazy split point (t3-face C09): this is the ONE file that statically imports the fork's markdown
// stack (Streamdown + the CodeMirror-backed code renderer, via ai-elements/message.tsx). Fleet is
// eagerly reached from src/main.tsx (WorkspaceSurface -> FleetStack -> ... -> ConversationView), so
// importing this directly from TimelineRowView would drag streamdown/@codemirror into the app's
// startup bundle — a budget locked by src/app/eager-budget.test.ts. TimelineRowView instead loads
// this module through React.lazy, a dynamic-import boundary the static eager-graph tracer treats
// as lazy: the markdown stack downloads only once a unit's conversation actually has an assistant
// message to render, same as the editor/AI surfaces this budget already protects.
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";

export default function AssistantMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return (
    <Message from="assistant">
      <MessageContent>
        <MessageResponse streaming={streaming}>{text}</MessageResponse>
      </MessageContent>
    </Message>
  );
}
