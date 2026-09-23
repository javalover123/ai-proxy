import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript as jsLang } from "@codemirror/lang-javascript";
import { json as jsonLang, jsonParseLinter } from "@codemirror/lang-json";
import { xml as xmlLang } from "@codemirror/lang-xml";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { linter, lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { createImeDocChangeGate } from "./ime";
import { type EditorLanguage, type EffectiveEditorLang, resolveEffectiveLang } from "./language";

interface CodeEditorProps {
  value: string;
  language: EditorLanguage;
  onChange: (value: string) => void;
  readOnly?: boolean;
  wordWrap?: boolean;
}

function languageExtensions(lang: EffectiveEditorLang): Extension {
  switch (lang) {
    case "json":
      return [jsonLang(), linter(jsonParseLinter())];
    case "xml":
      return xmlLang();
    case "javascript":
      return jsLang();
    default:
      return [];
  }
}

function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-muted-foreground)",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 6%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 6%, transparent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 10%, transparent)",
    outline: "1px solid var(--color-border)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 16%, transparent)",
  },
  ".cm-scroller": {
    fontFamily: 'var(--font-mono, "Geist Mono", "Menlo", monospace)',
    fontSize: "var(--text-prose-lg, 0.875rem)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-panels": {
    backgroundColor: "var(--surface-elevated)",
    color: "var(--foreground)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--border)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--border)",
  },
  ".cm-textfield": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--input)",
  },
  ".cm-button": {
    background: "var(--secondary)",
    color: "var(--secondary-foreground)",
    border: "1px solid var(--border)",
    "&:hover": {
      background: "var(--accent)",
    },
  },
  ".cm-panel.cm-search label, .cm-panel.cm-search [name=close]": {
    color: "var(--muted-foreground)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 18%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 32%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 10%, transparent)",
  },
});

export default function CodeEditor({ value, language, onChange, readOnly = false, wordWrap = false }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompRef = useRef<Compartment | null>(null);
  const wrapCompRef = useRef<Compartment | null>(null);
  const readOnlyCompRef = useRef<Compartment | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const gateRef = useRef<ReturnType<typeof createImeDocChangeGate>>(null);
  if (!gateRef.current) {
    gateRef.current = createImeDocChangeGate((doc) => onChangeRef.current(doc));
  }

  const effectiveLang = resolveEffectiveLang(language, value);

  // biome-ignore lint/correctness/useExhaustiveDependencies: editor init once on mount
  useEffect(() => {
    const container = containerRef.current;
    const gate = gateRef.current;
    if (!container || !gate) return;

    const languageComp = new Compartment();
    const wrapComp = new Compartment();
    const readOnlyComp = new Compartment();
    languageCompRef.current = languageComp;
    wrapCompRef.current = wrapComp;
    readOnlyCompRef.current = readOnlyComp;

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(classHighlighter),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          languageComp.of(languageExtensions(effectiveLang)),
          wrapComp.of(wordWrap ? EditorView.lineWrapping : []),
          readOnlyComp.of(readOnlyExtensions(readOnly)),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.view.composing) gate.compositionStart();
            gate.onDocChanged(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            compositionstart() {
              gate.compositionStart();
              return false;
            },
            compositionend(_event, currentView) {
              gate.compositionEnd(currentView.state.doc.toString());
              return false;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      languageCompRef.current = null;
      wrapCompRef.current = null;
      readOnlyCompRef.current = null;
    };
    // EditorView is created once; language / wrap / readOnly / value sync via later effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    const languageComp = languageCompRef.current;
    if (!view || !languageComp) return;
    view.dispatch({
      effects: languageComp.reconfigure(languageExtensions(effectiveLang)),
    });
  }, [effectiveLang]);

  useEffect(() => {
    const view = viewRef.current;
    const wrapComp = wrapCompRef.current;
    if (!view || !wrapComp) return;
    view.dispatch({
      effects: wrapComp.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  useEffect(() => {
    const view = viewRef.current;
    const readOnlyComp = readOnlyCompRef.current;
    if (!view || !readOnlyComp) return;
    view.dispatch({
      effects: readOnlyComp.reconfigure(readOnlyExtensions(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    const gate = gateRef.current;
    if (!view || !gate || gate.composing || view.composing) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={containerRef} className="size-full overflow-auto" />;
}
