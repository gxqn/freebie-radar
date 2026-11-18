#!/usr/bin/env python3
"""Build and publish UI assets + the existing Pages edge bundle only.

Never connects to the VM, rebuilds the backend, backs up/restores databases,
changes bindings/secrets, or deploys the scheduler. Initial infrastructure setup
is separate. Existing Pages bindings and credentials remain untouched.
"""
import argparse
from pathlib import Path
import shutil
import sys
import tempfile

from deploy_release import Local, build_frontend, new_release, stage_pages

ROOT = Path(__file__).resolve().parents[1]


def preflight(root):
    if not shutil.which('node'):
        raise RuntimeError('Node.js is required')
    for filename in ('node_modules/typescript/bin/tsc', 'node_modules/vite/bin/vite.js',
                     'node_modules/vite/package.json', 'deploy/cloudflare/edge.mjs'):
        if not (root / filename).is_file():
            raise RuntimeError('Missing local dependency/file: ' + filename)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true', help='Check local files only; no build or network')
    modes.add_argument('--dry-run', action='store_true', help='Build and stage Pages payload; do not publish')
    args = parser.parse_args()
    try:
        preflight(ROOT)
        if args.check:
            print('CHECK OK: local Node/Vite/TypeScript/edge files are available. No network or VM access.')
            return 0
        local = Local(ROOT)
        # Outside the repository so Pages cannot accidentally consume the scheduler config.
        build = Path(tempfile.mkdtemp(prefix='freebie-frontend-'))
        release = new_release()
        print('Building frontend ' + release + ' (no backend/database operations)…', flush=True)
        bundle = build / 'edge-worker.js'
        build_frontend(ROOT, bundle, local.run)
        pages = build / 'pages'
        stage_pages(ROOT / 'dist/web', bundle, pages, release)
        if args.dry_run:
            print('DRY RUN OK: Pages payload at ' + str(pages) + '; no cloud/VM changes.')
            return 0
        print('Publishing Pages zoomzero / develop; Wrangler may open browser authorization…', flush=True)
        local.publish(pages)
        print('PUBLISHED: https://zoomzero.pages.dev — UI ' + release + '; index no-store, hashed assets immutable.')
        return 0
    except (Exception, KeyboardInterrupt) as error:
        print('UI PUBLISH FAILED: ' + str(error), file=sys.stderr)
        print('No VM/backend/database/resource/secret changes were attempted by this script.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
