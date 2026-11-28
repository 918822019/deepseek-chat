"""Mount the shipping disk image and run its UI, shared native helper and a local streaming model."""
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[2]
REPORT = "# 会议摘要\n\n周宁负责预算，金额为 7350 元。\n\n来源：会议.docx、预算.xlsx。\n"


def samples(folder):
    folder.mkdir()
    types = 'http://schemas.openxmlformats.org/package/2006/content-types'
    rel = 'http://schemas.openxmlformats.org/package/2006/relationships'
    office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    sheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    with ZipFile(folder / '会议.docx', 'w', ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', f'<Types xmlns="{types}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr('_rels/.rels', f'<Relationships xmlns="{rel}"><Relationship Id="rId1" Type="{office}/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr('word/document.xml', f'<w:document xmlns:w="{word}"><w:body><w:p><w:r><w:t>负责人是周宁。</w:t></w:r></w:p></w:body></w:document>')
    with ZipFile(folder / '预算.xlsx', 'w', ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', f'<Types xmlns="{types}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr('_rels/.rels', f'<Relationships xmlns="{rel}"><Relationship Id="rId1" Type="{office}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml', f'<workbook xmlns="{sheet}" xmlns:r="{office}"><sheets><sheet name="预算" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', f'<Relationships xmlns="{rel}"><Relationship Id="rId1" Type="{office}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', f'<worksheet xmlns="{sheet}"><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>预算</t></is></c><c r="B2"><v>7350</v></c></row></sheetData></worksheet>')


class Model(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.end_headers()

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        prompt = json.loads(request['messages'][-1]['content'])
        sources = {item['name']: item['content'] for item in prompt['sources']}
        assert self.path == '/v1/chat/completions' and request['model'] == 'workspace-ci'
        assert self.headers['Authorization'] == 'Bearer local-test-only'
        assert '负责人是周宁' in sources['会议.docx'] and 'B2=7350' in sources['预算.xlsx'], sources
        self.server.requests += 1
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        for content in (REPORT[:9], REPORT[9:]):
            frame = {'choices': [{'delta': {'content': content}}]}
            self.wfile.write(('data: ' + json.dumps(frame) + '\n\n').encode())
            self.wfile.flush()
        self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')


def run(*args):
    subprocess.run(args, check=True)


def check_office_helper(bundle, inputs, profile):
    executable = bundle/'Contents/Helpers/WorkspaceHost'
    with subprocess.Popen([executable, bundle/'Contents/Resources/dist', profile], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, text=True, encoding='utf-8') as helper:
        def send(action, **values):
            helper.stdin.write(json.dumps(dict(Id=str(uuid.uuid4()), Action=action, **values))+'\n')
            helper.stdin.flush()
            result = json.loads(helper.stdout.readline())
            assert 'error' not in result, (action, result)
            return result['value']
        try:
            assert json.loads(helper.stdout.readline())['origin'].startswith('http://127.0.0.1:')
            grant = send('grant', Path=str(inputs.resolve()))
            assert len(grant['files']) == 2
            assert '周宁' in send('read', WorkspaceId=grant['id'], Name='会议.docx')['content']
            assert 'B2=7350' in send('read', WorkspaceId=grant['id'], Name='预算.xlsx')['content']
            print('PASS mounted native helper read both Office documents', flush=True)
        finally:
            helper.stdin.close()


def verify(dmg):
    assert platform.system() == 'Darwin' and platform.machine() == 'arm64'
    with tempfile.TemporaryDirectory() as temp:
        base = Path(temp).resolve()
        mount, inputs = base / 'mounted', base / '项目资料'
        mount.mkdir()
        samples(inputs)
        binary = base / 'WorkspaceCheck'
        run('xcrun', 'swiftc', '-swift-version', '5', '-target', 'arm64-apple-macos14.0',
            ROOT / 'macos/HostProcess.swift', ROOT / 'macos/WorkspaceApp.swift', ROOT / 'macos/tests/main.swift', '-o', binary)
        run('hdiutil', 'verify', '-quiet', dmg)
        run('hdiutil', 'attach', '-quiet', '-nobrowse', '-readonly', '-mountpoint', mount, dmg)
        try:
            bundle = mount / 'Desktop Workspace.app'
            run('codesign', '--verify', '--deep', '--strict', bundle)
            assert (mount / 'Applications').is_symlink()
            for name in ('MacOS/Workspace', 'Helpers/WorkspaceHost'):
                assert subprocess.check_output(['lipo','-archs',bundle/'Contents'/name], text=True).strip() == 'arm64'
            check_office_helper(bundle, inputs, base / 'helper-profile')
            # Launch the actual executable directly from the read-only mounted bundle.
            with subprocess.Popen([bundle/'Contents/MacOS/Workspace']) as app:
                try:
                    port_file = Path.home()/'Library/Application Support/io.github.918822019.deepseek-chat/origin-port'
                    for _ in range(150):
                        if app.poll() is not None: raise RuntimeError('Shipping app exited during startup')
                        try:
                            with urllib.request.urlopen('http://127.0.0.1:'+port_file.read_text()+'/index.html', timeout=1) as page:
                                if b'id="root"' in page.read(): break
                        except (OSError, ValueError): pass
                        time.sleep(.1)
                    else: raise RuntimeError('Shipping app did not serve its bundled frontend')
                finally:
                    app.terminate()
            with ThreadingHTTPServer(('127.0.0.1', 0), Model) as server:
                server.requests = 0
                threading.Thread(target=server.serve_forever, daemon=True).start()
                try:
                    model = 'http://127.0.0.1:' + str(server.server_port) + '/v1'
                    run(binary, bundle, base / 'profile', inputs, model, ROOT/'macos/tests/flow.js')
                except subprocess.CalledProcessError:
                    grants = (base / 'profile' / 'TaskWorkspaces').glob('*')
                    print('Accepted test folders:', [grant.read_text() for grant in grants], flush=True)
                    raise
                finally: server.shutdown()
                assert server.requests == 1
            docs = list((inputs/'工作台成果').glob('*.md'))
            assert len(docs) == 1 and docs[0].read_text(encoding='utf-8') == REPORT
            print('PASS mounted DMG, arm64 signatures, shipping app launch and exact Markdown contents', flush=True)
        finally:
            run('hdiutil', 'detach', '-quiet', mount)


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve())
