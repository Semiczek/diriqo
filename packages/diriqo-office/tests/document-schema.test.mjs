import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {TableKit} from '@tiptap/extension-table';
import {TextStyleKit} from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import {createTemplate} from '../src/core/templates.ts';
import {validateContent} from '../src/core/validation.ts';
test('actual Tiptap schema defaults roundtrip all text templates including editable table alignment',()=>{
 const schema=getSchema([StarterKit,TableKit,TextStyleKit,TextAlign.configure({types:['paragraph','heading']})]);
 for(const name of ['quote','workReport','handover','letter']){
  const document=createTemplate(name,{companyName:'Example',date:'2026-10-11'});
  document.doc=schema.nodeFromJSON(document.doc).toJSON();assert.doesNotThrow(()=>validateContent(document),name);
 }
 const document=createTemplate('quote');const cell=document.doc.content.find(n=>n.type==='table').content[0].content[0];
 cell.attrs={align:'center'};assert.doesNotThrow(()=>validateContent(document));
 cell.attrs={align:'url(https://example.test)'};assert.throws(()=>validateContent(document),/UNSAFE_STYLE/);
});
