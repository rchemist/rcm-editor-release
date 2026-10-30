import { RcmEditor } from '@rchemist/editor/react';
import { ConsumerEditor } from './ConsumerEditor.jsx';

export function App() {
  return (
    <main>
      <section data-testid="bare">
        <RcmEditor />
      </section>
      <ConsumerEditor />
    </main>
  );
}
