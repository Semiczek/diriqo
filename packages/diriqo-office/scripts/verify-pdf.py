"""Independent validation using an existing pypdf runtime; no installs or network.
Usage: existing-python scripts/verify-pdf.py output/pdf/diriqo-office-czech.pdf
"""
import hashlib, json, pathlib, sys
from pypdf import PdfReader

path = pathlib.Path(sys.argv[1])
expected = json.loads((path.parent / 'expected.json').read_text(encoding='utf-8'))
reader = PdfReader(path, strict=True)
assert 'SIL OPEN FONT LICENSE Version 1.1' in reader.metadata['/FontLicense']
assert 'Copyright 2024 The Geist Project Authors' in reader.metadata['/FontLicense']
assert not reader.is_encrypted and 3 <= len(reader.pages) <= 20
assert not any(k in reader.trailer['/Root'] for k in ['/OpenAction','/AA','/AcroForm','/Names'])
texts = []
for i, page in enumerate(reader.pages):
    assert float(page.mediabox.width) == 595.28 and float(page.mediabox.height) == 841.89
    assert not page.get('/Annots')
    text = page.extract_text()
    texts.append(text)
    compact = ''.join(text.split())
    assert ''.join(expected['header'].split()) in compact
    assert ''.join(expected['footer'].split()) in compact
    assert f'{i+1}/{len(reader.pages)}' in compact
    font = page['/Resources']['/Font']['/F1'].get_object()
    assert font['/Subtype'] == '/Type0' and font['/Encoding'] == '/Identity-H'
    font_bytes = font['/DescendantFonts'][0].get_object()['/FontDescriptor']['/FontFile2'].get_data()
    assert hashlib.sha256(font_bytes).hexdigest() == 'bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76'
    def position(text, cm, tm, font_dict, font_size):
        if text.strip():
            assert 0 <= tm[4] <= 595.28 and 0 <= tm[5] <= 841.89, (i, tm)
    page.extract_text(visitor_text=position)
joined = '\n'.join(texts)
compact = ''.join(joined.split())
for text in expected['mustContain']:
    assert ''.join(text.split()) in compact, text
# Headers/footers interrupt the physical text stream at page boundaries.
body = compact
for i in range(len(texts)):
    body = body.replace(''.join(expected['header'].split()), '').replace(''.join(expected['footer'].split()), '').replace(f'{i+1}/{len(texts)}', '')
assert expected['longWord'] in body, 'Long word truncated'
assert body.count(''.join(expected['repeatedText'].split())) == expected['repeatCount'], 'Table text lost or duplicated'
result = {'status':'PASS','parser':'pypdf','pages':len(texts),'textCharacters':len(joined),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'checks':['strict independent PDF parser','embedded font hash','Czech text and currency extraction','every page header/footer/number','all 150 repeated table sentences','long unbroken word','text origin inside MediaBox','no active forms/links/actions']}
(path.parent / 'independent-validation.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
