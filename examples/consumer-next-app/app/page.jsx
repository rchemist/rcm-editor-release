// Server Component: renders the published client component directly (relies on its "use client").
import { RcmEditor } from '@rchemist/editor/react';
import { ConsumerEditor } from './ConsumerEditor.jsx';

export default function Page() {
  return (
    <main>
      <section data-testid="bare">
        <RcmEditor />
      </section>
      <ConsumerEditor />
    </main>
  );
}
