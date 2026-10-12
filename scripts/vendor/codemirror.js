// Only the third-party APIs used by public/query-editor.js are bundled.
export { EditorState, Prec } from '@codemirror/state';
export { EditorView, Decoration, ViewPlugin, keymap, placeholder } from '@codemirror/view';
export { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
export { autocompletion, completionKeymap, acceptCompletion, closeCompletion } from '@codemirror/autocomplete';
