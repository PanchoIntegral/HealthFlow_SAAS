'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect } from 'react';
import { IconList } from './icons';

/**
 * Editor de texto enriquecido (TipTap/ProseMirror) para las secciones de texto
 * libre del reporte NOM-004 (p.ej. padecimiento actual). Emite HTML.
 */
export function RichTextEditor({
  value,
  onChange,
  editable = true,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: value,
    editable,
    immediatelyRender: false, // evita mismatch de hidratación en Next.js
    editorProps: {
      attributes: {
        // Sin `prose`: esas clases son de @tailwindcss/typography, que no está
        // instalado, así que no hacían nada. Las viñetas y los márgenes salen
        // de las reglas .ProseMirror de globals.css.
        class:
          'min-h-[120px] rounded-b-lg border border-t-0 border-slate-300 px-3 py-2 text-sm focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Mantiene el editor sincronizado si el valor cambia desde fuera (hidratación).
  useEffect(() => {
    if (editor && !editor.isFocused && editor.getHTML() !== value) {
      editor.commands.setContent(value || '', false);
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) {
    return <div className="min-h-[160px] rounded-lg border border-slate-300 bg-slate-50" />;
  }

  return (
    <div>
      {editable && (
        <div className="flex gap-1 rounded-t-lg border border-slate-300 bg-slate-50 px-2 py-1.5">
          <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <em>i</em>
          </ToolbarButton>
          <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <IconList />
          </ToolbarButton>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid h-7 w-8 place-items-center rounded text-sm ${active ? 'bg-brand-blue/10 text-brand-blue' : 'text-slate-600 hover:bg-slate-200'}`}
    >
      {children}
    </button>
  );
}
