"""Independent, offline proof for the PDF downloaded by the guarded HTTP helper.
Uses an already available pypdf runtime; performs no installation or network I/O.
"""
import hashlib, json, pathlib, re, sys, unicodedata
import pypdf

directory = pathlib.Path('output/pdf')
host = sys.argv[1] if len(sys.argv) == 2 else 'diriqo'
assert host in ['hub','diriqo'] and len(sys.argv) <= 2, 'Only hub or diriqo is allowed'
pdf = directory / f'public-{host}-restored.pdf'
http = json.loads((directory / f'public-{host}-restored-http.json').read_text(encoding='utf-8'))
assert http['host'] == host
assert http['status'] == 'PASS_HTTP_PENDING_INDEPENDENT_PARSE'
assert http['restoredHistory']['exactContentMatch'] is True
digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
assert digest == http['sha256']
reader = pypdf.PdfReader(pdf, strict=True)
assert not reader.is_encrypted and 1 <= len(reader.pages) <= 10
assert reader.metadata['/Producer'] == 'Diriqo Office'
assert 'SIL OPEN FONT LICENSE Version 1.1' in reader.metadata['/FontLicense']
assert 'Copyright 2024 The Geist Project Authors' in reader.metadata['/FontLicense']
assert not any(key in reader.trailer['/Root'] for key in ['/OpenAction', '/AA', '/AcroForm', '/Names'])
texts = []
for page in reader.pages:
    assert float(page.mediabox.width) == 595.28 and float(page.mediabox.height) == 841.89
    assert not page.get('/Annots')
    font = page['/Resources']['/Font']['/F1'].get_object()
    embedded = font['/DescendantFonts'][0].get_object()['/FontDescriptor']['/FontFile2'].get_data()
    assert hashlib.sha256(embedded).hexdigest() == 'bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76'
    texts.append(page.extract_text())
compact = ''.join('\n'.join(texts).split())
assert ('Přílišžluťoučký' if host == 'diriqo' else 'JSPD–původníověřenáverze.') in compact
assert ('12345Kč' if host == 'diriqo' else '8765Kč') in compact
assert 'druháverze' not in compact.casefold()
body = ''.join(re.sub(r'\s*'+str(i+1)+r'\s*/\s*'+str(len(texts))+r'\s*$', '', text) for i,text in enumerate(texts))
body = ''.join(unicodedata.normalize('NFC', body).split())
if 'currentTextSha256Normalized' in http:
    assert hashlib.sha256(body.encode('utf-8')).hexdigest() == http['currentTextSha256Normalized'], 'Exported text differs from authorized current document'
report = {
    'schemaVersion': 1, 'status': 'PASS_INDEPENDENT_PARSE',
    'scope': 'Actual public HTTP export bytes parsed offline; native browser print and physical printer not tested',
    'parser': 'pypdf', 'parserVersion': pypdf.__version__, 'strict': True,
    'sourceHttpReport': f'output/pdf/public-{host}-restored-http.json',
    'host': http['host'], 'origin': http['origin'], 'deploymentId': http['deploymentId'],
    'projectRef': http['projectRef'], 'fileId': http['fileId'], 'revision': http['revision'],
    'output': str(pdf).replace('\\', '/'), 'sha256': digest,
    'bytes': pdf.stat().st_size, 'pages': len(reader.pages), 'format': 'A4',
    'checks': ['exact SHA256 binding to authenticated public HTTP response',
               'strict independent PDF parse', 'original Czech text retained',
               'original amount retained', 'second-version text absent',
               'unmodified embedded OFL font hash and full OFL metadata',
               'no active actions, forms or annotations'],
}
if 'currentTextSha256Normalized' in http:
    report['checks'].append('exact normalized PDF body hash matches authorized current document')
(directory / f'public-{host}-restored-validation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'status':report['status'],'pages':report['pages'],'bytes':report['bytes'],'sha256':digest,'revision':report['revision']}))
