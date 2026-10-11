import { EditorState, Prec } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, placeholder } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap, acceptCompletion, closeCompletion } from '@codemirror/autocomplete';
import { tokenizeQuery, queryCompletions, queryError } from '../public/query.js';

function highlights(view) {
  const marks = [];
  for (const token of tokenizeQuery(view.state.doc.toString())) {
    if (!token.key) continue;
    const colon = token.from + token.raw.indexOf(':');
    marks.push(Decoration.mark({ class: 'query-key' }).range(token.from, colon + 1));
    if (colon + 1 < token.to) marks.push(Decoration.mark({ class: token.value === '@me' ? 'query-me' : 'query-value' }).range(colon + 1, token.to));
  }
  return Decoration.set(marks);
}

export function createQueryEditor({ parent, value, onChange, onSubmit, getItems }) {
  const editor = new EditorView({
    parent,
    state: EditorState.create({ doc: value, extensions: [
      EditorView.cspNonce.of(document.querySelector('meta[name="style-nonce"]').content),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of(view => ({ role: 'textbox', 'aria-label': 'Search pull requests', 'aria-describedby': 'query-help query-feedback', 'aria-multiline': 'false', 'aria-invalid': String(Boolean(queryError(view.state.doc.toString()))), autocapitalize: 'off', spellcheck: 'false' })),
      placeholder('is:open involves:@me'),
      history(),
      EditorState.transactionFilter.of(tr => {
        if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
        // Pasting a multiline query keeps the search field on one logical line.
        const doc = tr.newDoc.toString().replace(/[\r\n]+/g, ' ');
        return { changes: { from: 0, to: tr.startState.doc.length, insert: doc }, selection: { anchor: Math.min(tr.newSelection.main.head, doc.length) } };
      }),
      ViewPlugin.fromClass(class {
        constructor(view) { this.decorations = highlights(view); }
        update(update) { if (update.docChanged) this.decorations = highlights(update.view); }
      }, { decorations: plugin => plugin.decorations }),
      autocompletion({
        override: [context => queryCompletions(context.state.doc.toString(), context.pos, getItems(), context.explicit)],
        activateOnTypingDelay: 80, interactionDelay: 0, defaultKeymap: false, icons: false,
        activateOnCompletion: completion => completion.label.endsWith(':'),
      }),
      Prec.highest(keymap.of([
        { key: 'Enter', run(view) { if (!acceptCompletion(view)) onSubmit(); return true; } },
        { key: 'Escape', run: closeCompletion },
        { key: 'Tab', run: acceptCompletion },
        ...completionKeymap.filter(binding => !['Enter', 'Escape'].includes(binding.key)),
      ])),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of(update => { if (update.docChanged) onChange(update.state.doc.toString()); }),
    ] }),
  });
  return {
    get value() { return editor.state.doc.toString(); },
    setValue(next) {
      if (next !== editor.state.doc.toString()) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
    },
    focus() { editor.focus(); },
  };
}
