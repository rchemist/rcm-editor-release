import '@rchemist/editor/styles.css';
import { mountEditor } from '@rchemist/editor/vanilla';

// Framework-free consumer: no React code here — react/react-dom are peer dependencies
// npm installs automatically next to @rchemist/editor.
const host = document.getElementById('editor');
const html = document.querySelector('[data-testid="vanilla-html"]');

let mounted = null;
let readonly = false;

function mount() {
  mounted = mountEditor(host, {
    readonly,
    editorProps: { attributes: { 'data-testid': 'vanilla-editor' } },
    changeDebounceMs: 0,
    onChange: (change) => {
      html.textContent = change.html;
    },
  });
}

mount();

document.querySelector('[data-testid="vanilla-readonly"]').addEventListener('click', () => {
  readonly = !readonly;
  mounted?.setReadonly(readonly);
});
document.querySelector('[data-testid="vanilla-destroy"]').addEventListener('click', () => {
  mounted?.destroy();
  mounted = null;
});
document.querySelector('[data-testid="vanilla-remount"]').addEventListener('click', () => {
  mounted?.destroy(); // idempotent: safe whether or not an instance is still alive
  mount();
});
