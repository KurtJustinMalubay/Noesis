import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { AppTheme } from "../../ai/keyStore";
import type { QuizLanguage } from "../../types/domain";

const grammarCache = new Map<QuizLanguage, Promise<Extension>>();

function loadGrammar(language: QuizLanguage): Promise<Extension> {
  const cached = grammarCache.get(language);
  if (cached) return cached;

  grammarCache.clear();
  const grammar = (async (): Promise<Extension> => {
    switch (language) {
      case "C":
        return StreamLanguage.define(
          (await import("@codemirror/legacy-modes/mode/clike")).c
        );
      case "C++":
        return (await import("@codemirror/lang-cpp")).cpp();
      case "C#":
        return StreamLanguage.define(
          (await import("@codemirror/legacy-modes/mode/clike")).csharp
        );
      case "Python":
        return (await import("@codemirror/lang-python")).python();
      case "Java":
        return (await import("@codemirror/lang-java")).java();
      case "JavaScript":
        return (await import("@codemirror/lang-javascript")).javascript();
      case "TypeScript":
        return (await import("@codemirror/lang-javascript")).javascript({
          typescript: true,
        });
      case "Rust":
        return (await import("@codemirror/lang-rust")).rust();
      case "SQL":
        return (await import("@codemirror/lang-sql")).sql();
      case "Go":
        return StreamLanguage.define(
          (await import("@codemirror/legacy-modes/mode/go")).go
        );
      case "auto":
        return [];
    }
  })();
  grammarCache.set(language, grammar);
  return grammar;
}

interface CodeEditorProps {
  language: QuizLanguage;
  theme: AppTheme;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}

export function CodeEditor({
  language,
  theme,
  value,
  readOnly = false,
  onChange,
}: CodeEditorProps) {
  const [languageExtension, setLanguageExtension] = useState<Extension[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestId = useRef(0);
  const isDark = theme === "mica-dark";
  const editorTheme = useMemo(
    () =>
      EditorView.theme(
        {
          "&": {
            color: isDark ? "#d4d4d4" : "#263238",
            backgroundColor: isDark ? "#1e1e1e" : "#ffffff",
          },
          ".cm-content": { fontFamily: "Cascadia Code, Consolas, monospace" },
          ".cm-gutters": {
            color: isDark ? "#858585" : "#7c8991",
            backgroundColor: isDark ? "#1e1e1e" : "#faf8f5",
            border: "none",
          },
          ".cm-activeLine": {
            backgroundColor: isDark ? "#ffffff0a" : "#17324d08",
          },
          ".cm-activeLineGutter": {
            backgroundColor: isDark ? "#ffffff0a" : "#17324d08",
          },
        },
        { dark: isDark }
      ),
    [isDark]
  );

  useEffect(() => {
    const request = ++requestId.current;
    setLanguageExtension([]);
    setLoadError(null);
    void loadGrammar(language)
      .then((extension) => {
        if (request === requestId.current) setLanguageExtension([extension]);
      })
      .catch((error: unknown) => {
        if (request === requestId.current) {
          setLoadError(
            error instanceof Error ? error.message : "Could not load language support."
          );
        }
      });
    return () => {
      requestId.current += 1;
    };
  }, [language]);

  const extensions = useMemo(
    () => [...languageExtension, editorTheme] as Extension[],
    [editorTheme, languageExtension]
  );

  return (
    <div className="relative h-full min-h-[280px] overflow-auto">
      {loadError && (
        <p role="alert" className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-800">
          {loadError} Syntax highlighting is unavailable for this language.
        </p>
      )}
      <CodeMirror
        value={value}
        onChange={onChange}
        height="100%"
        theme={isDark ? "dark" : "light"}
        extensions={extensions}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
          history: true,
          autocompletion: false,
          tabSize: 2,
        }}
        indentWithTab
        className="h-full text-[13px]"
      />
    </div>
  );
}
