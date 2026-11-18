"""Frontend-only publishing helpers. No VM, database, resource or secret operations."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid

PROJECT = 'zoomzero'
WRANGLER_VERSION = '4.161.0'


def new_release():
    return datetime.now(timezone.utc).strftime('ui-%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:6]


def build_frontend(root, bundle, run):
    """Use the already installed project toolchain, never pnpm/Corepack/install."""
    root = Path(root)
    run(['node', str(root / 'node_modules/typescript/bin/tsc'), '--noEmit'])
    run(['node', str(root / 'node_modules/vite/bin/vite.js'), 'build'])
    script = """const {createRequire}=require('node:module');
const r=createRequire(require('node:fs').realpathSync(process.argv[1]));
r('esbuild').buildSync({entryPoints:[process.argv[2]],outfile:process.argv[3],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});"""
    run(['node', '-e', script, str(root / 'node_modules/vite/package.json'),
         str(root / 'deploy/cloudflare/edge.mjs'), str(bundle)])


def stage_pages(web, bundle, output, release):
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', release):
        raise ValueError('Invalid UI release label')
    web, output = Path(web), Path(output)
    output.mkdir(parents=True, exist_ok=False)
    extensions = {'.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg',
                  '.ico', '.webp', '.woff', '.woff2', '.txt', '.xml'}
    for source in web.rglob('*'):
        relative = source.relative_to(web)
        if (not source.is_file() or source.is_symlink() or source.suffix not in extensions
                or any(part.startswith('.') or part == 'node_modules' for part in relative.parts)
                or re.search(r'\.(?:test|spec)\.', source.name)):
            continue
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    index = output / 'index.html'
    if not index.is_file():
        raise RuntimeError('Vite output has no index.html')
    html = index.read_text()
    meta = '<meta name="radar-release" content="' + release + '">'
    index.write_text(html.replace('</head>', meta + '</head>') if '</head>' in html else meta + html)
    shutil.copyfile(bundle, output / '_worker.js')
    (output / '_routes.json').write_text(json.dumps({'version': 1, 'include': ['/*'], 'exclude': []}))
    (output / '_headers').write_text('/\n  Cache-Control: no-store\n/index.html\n  Cache-Control: no-store\n/release.json\n  Cache-Control: no-store\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n')
    (output / 'release.json').write_text(json.dumps({'release': release}))


class Local:
    def __init__(self, root):
        self.root = Path(root)
        self.env = os.environ.copy()
        self.env.update({'XDG_CONFIG_HOME': str(self.root / '.wrangler'),
                         'npm_config_cache': str(self.root / '.wrangler/npm-cache'),
                         'WRANGLER_SEND_METRICS': 'false'})

    def run(self, command, cwd=None):
        result = subprocess.run(command, cwd=str(cwd or self.root), env=self.env)
        if result.returncode:
            raise RuntimeError(Path(command[0]).name + ' failed (exit ' + str(result.returncode) + ')')

    def wrangler(self):
        # The temporary local tooling cache is also project-owned, never a Desktop checkout.
        for path in [self.root / 'node_modules/wrangler/bin/wrangler.js',
                     self.root / '.deploy-private/tooling/node_modules/wrangler/bin/wrangler.js']:
            if path.is_file():
                package = json.loads((path.parent.parent / 'package.json').read_text())
                if package.get('version') == WRANGLER_VERSION:
                    return ['node', str(path)]
        return ['npx', '--yes', '--cache', str(self.root / '.wrangler/npm-cache'),
                'wrangler@' + WRANGLER_VERSION]

    def publish(self, pages):
        # Run from the isolated payload, not beside the scheduler's wrangler.toml.
        self.run(self.wrangler() + ['pages', 'deploy', str(pages), '--project-name', PROJECT,
                                  '--branch', 'develop', '--commit-dirty=true'], cwd=pages)
