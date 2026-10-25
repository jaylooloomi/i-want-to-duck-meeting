"""Offline stdlib line coverage for local Python tests; never downloads models."""
import argparse
import dis
import json
from pathlib import Path
import site
import sys
import trace
import types
import unittest


def executable_lines(code):
    lines = {line for _, line in dis.findlinestarts(code) if line > 0}
    for child in code.co_consts:
        if isinstance(child, types.CodeType):
            lines.update(executable_lines(child))
    return lines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    stt = root / 'stt'
    sys.path.insert(0, str(stt))
    tracer = trace.Trace(count=True, trace=False, ignoredirs=[sys.prefix, sys.base_prefix, *site.getsitepackages()])

    def run():
        suite = unittest.defaultTestLoader.discover(str(stt), pattern='test_*.py')
        return unittest.TextTestRunner(verbosity=1).run(suite)

    result = tracer.runfunc(run)
    counts = tracer.results().counts
    rows = []
    for file in sorted(stt.glob('*.py')):
        if file.name.startswith('test_'):
            continue
        lines = executable_lines(compile(file.read_text(encoding='utf-8-sig'), str(file), 'exec'))
        hit = {line for (name, line), count in counts.items() if Path(name).resolve() == file.resolve() and count > 0}
        rows.append({'file': str(file.relative_to(root)), 'executableLines': len(lines), 'coveredLines': len(lines & hit)})
    report = {'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
              'skipped': len(result.skipped), 'kind': 'stdlib trace executable-line coverage; no branch metric', 'files': rows}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
