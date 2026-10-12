'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import type { DocumentContent, OfficeLocale } from '../core/types';
import { getOfficeMessages } from './locales';
const safeImage = (src: string) => src.length <= 3_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src);
const PageBreak = Node.create({ name: 'pageBreak', group: 'block', atom: true, parseHTML() { return [{ tag: 'div[data-office-page-break]' }]; }, renderHTML() { return ['div', { 'data-office-page-break': 'true', class: 'office-page-break' }, '']; } });
const Indent = Extension.create({ name: 'officeIndent', addGlobalAttributes() { return [{ types: ['paragraph', 'heading'], attributes: { indent: { default: 0, parseHTML: element => Math.min(8, Math.max(0, Math.round(parseFloat(element.style.marginLeft || '0') / 12))), renderHTML: attrs => attrs.indent ? { style: `margin-left: ${Math.min(8, Math.max(0, Number(attrs.indent) || 0)) * 12}px` } : {} } } }]; } });
const SafeImage = Image.extend({ renderHTML({ HTMLAttributes }) { return safeImage(String(HTMLAttributes.src || '')) ? ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)] : ['span', { 'data-image-removed': 'true' }]; } }).configure({ allowBase64: true });
/** Detached template content is inert while pasted content is sanitized. */
export function sanitizeOfficePaste(html: string): string {
  const template = document.createElement('template'); template.innerHTML = html;
  const tags = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'IMG']);
  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    if (!tags.has(element.tagName)) { element.remove(); continue; }
    for (const attr of Array.from(element.attributes)) {
      if (attr.name === 'href' && element.tagName === 'A' && /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(attr.value)) continue;
      if (attr.name === 'src' && element.tagName === 'IMG' && safeImage(attr.value)) continue;
      if (['colspan', 'rowspan'].includes(attr.name) && /^[1-9]\d?$/.test(attr.value)) continue;
      if (attr.name === 'style') { const allowed = ['font-family', 'font-size', 'color', 'background-color', 'text-align', 'line-height']; const style = allowed.map(key => { const value = (element as HTMLElement).style.getPropertyValue(key); return value && !/url|expression|@|[<>]/i.test(value) ? `${key}:${value}` : ''; }).filter(Boolean).join(';'); element.setAttribute('style', style); continue; }
      element.removeAttribute(attr.name);
    }
    if (element.tagName === 'IMG' && !element.getAttribute('src')) element.remove();
  }
  return template.innerHTML;
}
export type DocumentEditorProps = { content: DocumentContent; onChange: (content: DocumentContent) => void; readOnly?: boolean; locale?: OfficeLocale };
export function DocumentEditor({ content, onChange, readOnly = false, locale = 'cs' }: DocumentEditorProps) {
  const m = getOfficeMessages(locale); const latest = useRef(content); latest.current = content; const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const imageInput = useRef<HTMLInputElement>(null); const searchInput = useRef<HTMLInputElement>(null); const [findOpen, setFindOpen] = useState(false); const [find, setFind] = useState(''); const [replace, setReplace] = useState(''); const [notice, setNotice] = useState(''); const [, render] = useState(0);
  const editor = useEditor({ immediatelyRender: false, editable: !readOnly, extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false, protocols: ['https', 'http', 'mailto'] } }), TextStyleKit, TextAlign.configure({ types: ['heading', 'paragraph'] }), TableKit.configure({ table: { resizable: true } }), SafeImage, PageBreak, Indent], content: content.doc,
    editorProps: { attributes: { class: 'office-prose', 'aria-label': m.document }, transformPastedHTML: html => { const clean = sanitizeOfficePaste(html); if (clean !== html) setNotice(m.unsafePaste); return clean; }, handleDrop: (_view, event) => { if (event.dataTransfer?.files.length) { event.preventDefault(); return true; } return false; } },
    onUpdate: ({ editor: e }) => onChangeRef.current({ ...latest.current, doc: e.getJSON() }), onSelectionUpdate: () => render(n => n + 1), onTransaction: () => render(n => n + 1),
  });
  // Changing access mode is not a content edit and must not create a saved version.
  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);
  useEffect(() => { if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content.doc)) editor.commands.setContent(content.doc, { emitUpdate: false }); }, [editor, content.doc]);
  const page = (patch: Partial<DocumentContent['page']>) => onChange({ ...content, page: { ...content.page, ...patch } });
  function matches() { const result: { from: number; to: number }[] = []; if (!editor || !find) return result; editor.state.doc.descendants((node, pos) => { if (!node.isText || !node.text) return; let from = 0; while ((from = node.text.indexOf(find, from)) !== -1) { result.push({ from: pos + from, to: pos + from + find.length }); from += find.length; } }); return result; }
  function findNext() { if (!editor) return; const found = matches(); const item = found.find(item => item.from >= editor.state.selection.to) || found[0]; if (!item) { setNotice(m.noMatches); return; } editor.chain().setTextSelection(item).focus().run(); }
  function replaceAll() { if (!editor || readOnly) return; const found = matches(); if (!found.length) { setNotice(m.noMatches); return; } const tr = editor.state.tr; for (const item of found.reverse()) tr.insertText(replace, item.from, item.to); editor.view.dispatch(tr); }
  function setLink() { if (!editor) return; const href = window.prompt(m.linkHint, String(editor.getAttributes('link').href || 'https://')); if (href === null) return; if (!href) { editor.chain().focus().unsetLink().run(); return; } if (!/^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(href)) { setNotice(m.invalidLink); return; } editor.chain().focus().extendMarkRange('link').setLink({ href }).run(); }
  function indent(delta: number) { if (!editor) return; if (editor.isActive('listItem')) { delta > 0 ? editor.chain().focus().sinkListItem('listItem').run() : editor.chain().focus().liftListItem('listItem').run(); return; } const type = editor.isActive('heading') ? 'heading' : 'paragraph'; const value = Number(editor.getAttributes(type).indent) || 0; editor.chain().focus().updateAttributes(type, { indent: Math.min(8, Math.max(0, value + delta)) }).run(); }
  async function insertImage(file?: File) { if (!file || !editor) return; if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setNotice(m.imageLimit); return; } const bytes = new Uint8Array(await file.arrayBuffer()); if(editor.isDestroyed)return; const signature = (file.type === 'image/png' && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) || (file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) || (file.type === 'image/webp' && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'); if (!signature) { setNotice(m.imageLimit); return; } const reader = new FileReader(); reader.onload = () => { if (!editor.isDestroyed && typeof reader.result === 'string' && safeImage(reader.result)) editor.chain().focus().setImage({ src: reader.result, alt: file.name }).run(); }; reader.readAsDataURL(file); }
  const button = (label: string, action: () => unknown, selected = false, glyph?: string) => <button type="button" title={label} aria-label={label} aria-pressed={selected} disabled={readOnly || !editor} className={selected ? 'is-active' : ''} onMouseDown={event => event.preventDefault()} onClick={() => action()}>{glyph || label}</button>;
  if (!editor) return <div className="office-loading">{m.loading}</div>;
  return <section className="office-document-editor" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && ['f', 'h'].includes(event.key.toLowerCase())) { event.preventDefault(); setFindOpen(true); setTimeout(() => searchInput.current?.focus(), 0); } }}>
    <style>{`@media print{@page{size:A4;margin:${Math.max(5,Math.min(50,content.page.marginMm))}mm}}`}</style>
    <div className="office-editor-toolbar" role="toolbar" aria-label={m.document}>
      <div className="office-tool-group">{button(m.undo, () => editor.chain().focus().undo().run(), false, '↶')}{button(m.redo, () => editor.chain().focus().redo().run(), false, '↷')}</div>
      <select aria-label={m.paragraph} disabled={readOnly} value={editor.isActive('heading') ? editor.getAttributes('heading').level : 'paragraph'} onChange={event => event.target.value === 'paragraph' ? editor.chain().focus().setParagraph().run() : editor.chain().focus().toggleHeading({ level: Number(event.target.value) as 1 | 2 | 3 }).run()}><option value="paragraph">{m.paragraph}</option>{[1, 2, 3].map(n => <option value={n} key={n}>{m.heading} {n}</option>)}</select>
      <select aria-label={m.font} disabled={readOnly} value={editor.getAttributes('textStyle').fontFamily || 'Arial'} onChange={e => editor.chain().focus().setFontFamily(e.target.value).run()}>{['Arial', 'Georgia', 'Verdana', 'Times New Roman', 'Courier New'].map(font => <option key={font}>{font}</option>)}</select>
      <select aria-label={m.size} disabled={readOnly} value={editor.getAttributes('textStyle').fontSize || '12pt'} onChange={e => editor.chain().focus().setFontSize(e.target.value).run()}>{[8, 10, 11, 12, 14, 16, 18, 24, 32, 48].map(n => <option key={n} value={`${n}pt`}>{n}</option>)}</select>
      <div className="office-tool-group">{button(m.bold, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'B')}{button(m.italic, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'I')}{button(m.underline, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'U')}{button(m.strike, () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'), 'S̶')}</div>
      <label className="office-color" title={m.color}><span>A</span><input type="color" aria-label={m.color} disabled={readOnly} value={editor.getAttributes('textStyle').color || '#172033'} onChange={e => editor.chain().focus().setColor(e.target.value).run()} /></label>
      <label className="office-color" title={m.background}><span>▰</span><input type="color" aria-label={m.background} disabled={readOnly} value={editor.getAttributes('textStyle').backgroundColor || '#ffffff'} onChange={e => editor.chain().focus().setBackgroundColor(e.target.value).run()} /></label>
      <div className="office-tool-group">{button(m.alignLeft, () => editor.chain().focus().setTextAlign('left').run(), editor.isActive({ textAlign: 'left' }), '≡←')}{button(m.alignCenter, () => editor.chain().focus().setTextAlign('center').run(), editor.isActive({ textAlign: 'center' }), '≡')}{button(m.alignRight, () => editor.chain().focus().setTextAlign('right').run(), editor.isActive({ textAlign: 'right' }), '→≡')}{button(m.justify, () => editor.chain().focus().setTextAlign('justify').run(), editor.isActive({ textAlign: 'justify' }), '☷')}</div>
      {button(m.bulletList, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), '• ≡')}{button(m.orderedList, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), '1. ≡')}{button(m.outdent, () => indent(-1), false, '←')}{button(m.indent, () => indent(1), false, '→')}
      <select aria-label={m.lineHeight} disabled={readOnly} value={editor.getAttributes('textStyle').lineHeight || '1.5'} onChange={e => editor.chain().focus().setLineHeight(e.target.value).run()}>{['1', '1.15', '1.5', '2'].map(n => <option key={n} value={n}>{n} ×</option>)}</select>
      {button(m.hyperlink, setLink, editor.isActive('link'), '↗')}{button(m.insertTable, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), false, '▦')}{button(m.image, () => imageInput.current?.click(), false, '▧')}{button(m.pageBreak, () => editor.chain().focus().insertContent({ type: 'pageBreak' }).run(), false, '↧')}
      <button type="button" onClick={() => setFindOpen(v => !v)} aria-expanded={findOpen}>{m.find}</button>
      <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={e => { void insertImage(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
    {editor.isActive('table') && !readOnly && <div className="office-context-toolbar">{button(m.addRow, () => editor.chain().focus().addRowAfter().run())}{button(m.addColumn, () => editor.chain().focus().addColumnAfter().run())}{button(m.deleteRow, () => editor.chain().focus().deleteRow().run())}{button(m.deleteColumn, () => editor.chain().focus().deleteColumn().run())}{button(m.mergeCells, () => editor.chain().focus().mergeCells().run())}{button(m.splitCell, () => editor.chain().focus().splitCell().run())}{button(m.deleteTable, () => editor.chain().focus().deleteTable().run())}</div>}
    {findOpen && <div className="office-find"><input ref={searchInput} placeholder={m.find} aria-label={m.find} value={find} onChange={e => setFind(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') findNext(); }} /><button onClick={findNext}>{m.findNext}</button>{!readOnly && <><input placeholder={m.replace} aria-label={m.replace} value={replace} onChange={e => setReplace(e.target.value)} /><button onClick={replaceAll}>{m.replaceAll}</button></>}<button aria-label={m.close} onClick={() => setFindOpen(false)}>×</button></div>}
    <details className="office-page-settings"><summary>{m.pageSettings} · A4</summary><div><label>{m.margins}<input type="number" min={5} max={40} value={content.page.marginMm} disabled={readOnly} onChange={e => page({ marginMm: Math.min(40, Math.max(5, Number(e.target.value) || 20)) })} /></label><label>{m.header}<input value={content.page.header} maxLength={500} disabled={readOnly} onChange={e => page({ header: e.target.value })} /></label><label>{m.footer}<input value={content.page.footer} maxLength={500} disabled={readOnly} onChange={e => page({ footer: e.target.value })} /></label></div><p>{m.paginationNote}</p></details>
    {notice && <div className="office-notice" role="status">{notice}<button aria-label={m.close} onClick={() => setNotice('')}>×</button></div>}
    <div className="office-paper-stage"><article className="office-paper" style={{ padding: `${content.page.marginMm}mm` }}><div className="office-paper-header">{content.page.header}</div><EditorContent editor={editor} /><div className="office-paper-footer">{content.page.footer}</div></article></div>
  </section>;
}
export default DocumentEditor;
