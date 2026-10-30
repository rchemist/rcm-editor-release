// Drift scenario: the consumer pins its own @tiptap/starter-kit to an older patch. starter-kit
// lists @tiptap/core and @tiptap/pm as exact dependencies, so npm nests a second copy of both.
import { RcmEditor } from '@rchemist/editor/react';
import StarterKit from '@tiptap/starter-kit';

const extensions = () => [StarterKit];
const editorProps = { attributes: { 'data-testid': 'consumer-editor' } };

export function App() {
  return (
    <main>
      <RcmEditor extensions={extensions} editorProps={editorProps} />
    </main>
  );
}
