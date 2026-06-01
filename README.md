# Repo Health Doctor

[![npm version](https://img.shields.io/npm/v/repo-health-doctor.svg)](https://www.npmjs.com/package/repo-health-doctor)
[![GitHub](https://img.shields.io/badge/GitHub-repo--health--doctor-181717?logo=github)](https://github.com/yuanzhecheng17-collab/repo-health-doctor)
[![CI](https://github.com/yuanzhecheng17-collab/repo-health-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/yuanzhecheng17-collab/repo-health-doctor/actions/workflows/ci.yml)

Repo Health Doctor is a zero-dependency CLI that scores whether a repository is ready to publish on GitHub. It checks docs, dependency metadata, tests, CI, env-file hygiene, and obvious secret patterns.

It never reads private `.env` file contents. It only reports their file names and scans ordinary text files for risky secret patterns.

![Repo Health Doctor demo](assets/demo.gif)

## Quick Start

```sh
npx repo-health-doctor .
```

Package: [repo-health-doctor on npm](https://www.npmjs.com/package/repo-health-doctor)

For local development:

```sh
npm test
node src/index.js . --fail-under 70
node src/index.js . --json
```

## Checks

- README at the repository root
- LICENSE at the repository root
- `.gitignore`
- Dependency manifest such as `package.json`, `pyproject.toml`, `go.mod`, or `Cargo.toml`
- Lockfile when dependency manifests are present
- Test script, test directory, or test files
- CI workflow such as GitHub Actions
- Private `.env` files accidentally committed
- Environment template such as `.env.example`
- Obvious secret patterns in ordinary text files
- Community or release docs

## CLI

```sh
repo-health-doctor [path] [--json] [--fail-under <score>]
rhd [path]
```

Options:

- `--json`: print machine-readable JSON
- `--fail-under <score>`: exit with code `1` when the score is below the threshold
- `--help`: print help
- `--version`: print version

## Example Output

```text
Repo Health Doctor 0.1.0
Repository: /path/to/repo
Score: 86/100 (grade B)
Checks: 9/11 passed

[PASS] README present (12/12)
[FAIL] CI workflow present (0/10)
  Fix: Add a GitHub Actions workflow or another CI config that runs tests on pull requests.
```

## Publish Notes

Before publishing to npm:

```sh
npm test
npm publish --access public
```

## License

MIT
