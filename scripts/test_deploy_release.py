"""Small deterministic checks for the frontend-only publisher; no cloud calls."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_release as deploy


class FrontendReleaseTests(unittest.TestCase):
    def test_build_uses_node_local_tooling_without_package_install_or_remote_commands(self):
        calls = []
        with tempfile.TemporaryDirectory(prefix='radar project ') as directory:
            root = Path(directory)
            deploy.build_frontend(root, root / 'worker.js', lambda command: calls.append(command))
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0][-1], '--noEmit')
        self.assertEqual(calls[1][-1], 'build')
        self.assertTrue(all(Path(command[0]).name == 'node' for command in calls))
        self.assertIn('esbuild', calls[2][2])

    def test_pages_payload_has_cache_headers_and_no_private_or_test_files(self):
        with tempfile.TemporaryDirectory(prefix='radar project ') as directory:
            root = Path(directory); web = root / 'web'; web.mkdir()
            (web / 'index.html').write_text('<html><head></head>hello</html>')
            (web / 'assets').mkdir(); (web / 'assets/app-abc.js').write_text('public')
            (web / '.env').write_text('secret')
            (web / 'private.test.js').write_text('test')
            (web / 'leak.js').symlink_to(web / '.env')
            worker = root / 'worker.js'; worker.write_text('export default {}')
            output = root / 'pages'
            deploy.stage_pages(web, worker, output, 'ui-test')
            self.assertEqual({p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()},
                             {'index.html', 'assets/app-abc.js', '_worker.js', '_routes.json', '_headers', 'release.json'})
            self.assertIn('no-store', (output / '_headers').read_text())
            self.assertIn('immutable', (output / '_headers').read_text())
            self.assertIn('ui-test', (output / 'index.html').read_text())

    def test_launcher_quotes_paths_and_propagates_exit_status(self):
        launcher = Path(__file__).resolve().parents[1] / 'Deploy.command'
        with tempfile.TemporaryDirectory(prefix='double click project ') as directory:
            root = Path(directory); (root / 'scripts').mkdir()
            (root / 'Deploy.command').write_bytes(launcher.read_bytes())
            (root / 'scripts/deploy-instabox.py').write_text('import sys\nprint("ROOT PATH OK")\nsys.exit(7)\n')
            result = subprocess.run(['bash', str(root / 'Deploy.command'), '--check'], capture_output=True, text=True, cwd='/')
            self.assertEqual(result.returncode, 7)
            self.assertIn('ROOT PATH OK', result.stdout)


if __name__ == '__main__': unittest.main()
