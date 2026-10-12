"""Independent print-CSS proof with existing pypdf/pdfplumber. No installs or network.
Run after native-print-demo.mjs. PNG rendering/visual review remains a separate step.
"""
import hashlib,json,pathlib,re,sys,unicodedata
from pypdf import PdfReader
import pdfplumber

root=pathlib.Path(__file__).resolve().parents[1]
folder=root/'output/pdf/native-print'
manifest=json.loads((folder/'render-report.json').read_text(encoding='utf8'))
assert manifest['status']=='RENDERED_AWAITING_INDEPENDENT_PARSE_AND_VISUAL_CHECK', 'Render step not completed'
digest=lambda value:hashlib.sha256(value).hexdigest()
compact=lambda value:re.sub(r'\s+','',unicodedata.normalize('NFC',value))
assert digest((root/'src/client/office.css').read_bytes())==manifest['cssSha256'], 'CSS changed since print'
results=[]
for item in manifest['results']:
    name=item['name']; expected=json.loads((folder/f'{name}-expected.json').read_text(encoding='utf8'))
    assert digest((folder/f'{name}.html').read_bytes())==item['htmlSha256']
    pair={}
    for suffix in ['', '-server']:
        path=folder/f'{name}{suffix}.pdf'; reader=PdfReader(path,strict=True)
        if not suffix: assert digest(path.read_bytes())==item['sha256'], 'Browser PDF changed since render'
        # Chrome may paint the continued cell after later text objects. Sort spatially
        # using an independent parser so cross-page table counts follow visible order.
        with pdfplumber.open(path) as spatial:
            texts=[page.extract_text() or '' for page in spatial.pages]
        assert 1<=len(texts)<=20
        assert not reader.is_encrypted
        assert all(len(compact(text))>20 for text in texts), (path.name,'blank page')
        if expected['kind']=='short': assert len(texts)==1, (path.name,'short document should fit one page')
        if expected['kind']=='long': assert len(texts)>=4, (path.name,'multipage fixture did not paginate')
        joined=compact('\n'.join(texts))
        assert not any(compact(marker) in joined for marker in expected['hiddenMarkers']), (path.name,'host UI printed')
        for marker in expected['mustContain']: assert compact(marker) in joined, (path.name,marker)
        for row in range(1,expected['tableRows']+1): assert joined.count(compact(f'ŘÁDEK {row:02}'))==1, (path.name,row)
        body=joined.replace(compact('Syntetická firma • tiskový test'),'').replace(compact('KONEC PATIČKY • syntetická data'),'').replace(compact('DRUHÝ SLOUPEC BEZ OŘEZU'),'')
        for number in range(1,len(texts)+1): body=body.replace(f'{number}/{len(texts)}','')
        if expected['tablePhrase']: assert body.count(compact(expected['tablePhrase']))==expected['tableRepeatCount'],(path.name,'table text lost/duplicated')
        if expected['longWord']:
            assert compact(expected['longWord']) in body,(path.name,'unbroken text truncated')
        assert 'TABULKAZARUČNÍMZLOMEM' not in compact(texts[0])
        if expected['kind']=='long': assert 'TABULKAZARUČNÍMZLOMEM' in compact(texts[1]),(path.name,'manual page break')
        page_info=[]
        with pdfplumber.open(path) as document:
            for number,page in enumerate(document.pages,1):
                assert abs(page.width-595.28)<1 and abs(page.height-841.89)<1,(path.name,'not A4')
                chars=[char for char in page.chars if char['text'].strip()]
                assert chars
                margin=expected['marginMm']*72/25.4
                bounds=[min(c['x0'] for c in chars),min(c['top'] for c in chars),max(c['x1'] for c in chars),max(c['bottom'] for c in chars)]
                # Server footer is positioned by baseline; 10 pt font descenders add < 4 pt.
                # Browser body/margins use actual CSS line boxes (2 pt rounding allowance).
                verticalTolerance=4 if suffix else 2
                assert bounds[0]>=margin-2 and bounds[2]<=page.width-margin+2,(path.name,number,'horizontal clipping',bounds)
                assert bounds[1]>=margin-2 and bounds[3]<=page.height-margin+verticalTolerance,(path.name,number,'vertical clipping',bounds)
                page_info.append({'page':number,'characters':len(chars),'boundsPt':[round(v,2) for v in bounds]})
        pair['browser' if not suffix else 'server']={'file':path.name,'sha256':digest(path.read_bytes()),'pages':len(texts),'pageDetails':page_info}
    results.append({'name':name,'status':'PASS','checks':['strict independent PDF parse','A4 and configured margins','all Czech markers and currency','no blank pages','host navigation/toolbars/panels absent','36 unique rows when long','80 complete repeated sentences when long','long unbroken word preserved','manual break starts table on page two','same required content in native print and server PDF'],'outputs':pair})
report={'status':'PASS','cssSha256':manifest['cssSha256'],'parser':'pypdf + pdfplumber (existing external validation tools)','results':results,'nativeDialogProved':False,'physicalPrinterProved':False,'visualInspection':'PENDING; render all pages and inspect before claiming layout proof'}
(folder/'independent-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(report,ensure_ascii=False))
