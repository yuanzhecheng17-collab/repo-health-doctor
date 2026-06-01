#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = '0.2.0';
const TEXT_FILE_LIMIT = 512 * 1024;
const CONFIG_FILES = ['.repo-health.json', 'repo-health.json'];

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.tmp-repos',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  'vendor',
  'target',
  '.venv',
  'venv',
  '__pycache__'
]);

const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avif',
  '.bin',
  '.bmp',
  '.class',
  '.dll',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.lockb',
  '.mov',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.so',
  '.tar',
  '.webp',
  '.zip'
]);

const SECRET_PATTERNS = [
  {
    id: 'private-key',
    label: 'private key block',
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i
  },
  {
    id: 'github-token',
    label: 'GitHub token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{30,}/
  },
  {
    id: 'openai-key',
    label: 'OpenAI API key',
    pattern: /sk-[A-Za-z0-9_-]{20,}/
  },
  {
    id: 'aws-access-key',
    label: 'AWS access key id',
    pattern: /AKIA[0-9A-Z]{16}/
  },
  {
    id: 'slack-token',
    label: 'Slack token',
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/
  },
  {
    id: 'generic-secret',
    label: 'hard-coded secret assignment',
    pattern: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][^'"\s]{16,}['"]/i
  }
];

const MANIFESTS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
  'mix.exs'
];

const LOCKFILES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'uv.lock',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
  'Gemfile.lock',
  'composer.lock'
];

export function parseArgs(argv) {
  const options = {
    target: '.',
    configPath: null,
    json: false,
    failUnder: null,
    help: false,
    version: false
  };

  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--config') {
      const raw = argv[index + 1];
      if (!raw) {
        throw new Error('--config requires a path');
      }
      options.configPath = raw;
      index += 1;
    } else if (arg.startsWith('--config=')) {
      const raw = arg.slice('--config='.length);
      if (!raw) {
        throw new Error('--config requires a path');
      }
      options.configPath = raw;
    } else if (arg === '--fail-under') {
      const raw = argv[index + 1];
      if (!raw) {
        throw new Error('--fail-under requires a number');
      }
      options.failUnder = parseThreshold(raw);
      index += 1;
    } else if (arg.startsWith('--fail-under=')) {
      options.failUnder = parseThreshold(arg.slice('--fail-under='.length));
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error('Expected at most one repository path');
  }

  if (positional[0]) {
    options.target = positional[0];
  }

  return options;
}

export function analyzeRepository(targetPath = '.', options = {}) {
  const root = path.resolve(targetPath);
  const stat = safeStat(root);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Repository path does not exist or is not a directory: ${root}`);
  }

  const config = loadConfig(root, options.configPath);
  const inventory = collectInventory(root, config.ignore);
  const rootFiles = new Set(inventory.rootFiles.map((file) => file.toLowerCase()));
  const rootDirs = new Set(inventory.rootDirs.map((dir) => dir.toLowerCase()));
  const allFiles = inventory.files.map((file) => file.relative);
  const lowerFiles = new Set(allFiles.map((file) => file.toLowerCase()));

  const manifests = MANIFESTS.filter((name) => rootFiles.has(name.toLowerCase()));
  const lockfiles = LOCKFILES.filter((name) => rootFiles.has(name.toLowerCase()));
  const packageInfo = readPackageInfo(root);
  const lockfileNeeded = needsLockfile(manifests, packageInfo);
  const sensitiveEnvFiles = allFiles.filter((file) => isSensitiveEnvFile(path.basename(file)));
  const envExamples = allFiles.filter((file) => isEnvExample(path.basename(file)));
  const secretScanEnabled = config.checks['secret-scan']?.enabled !== false;
  const secretFindings = secretScanEnabled ? findSecretFindings(root, inventory.files) : [];
  const testEvidence = findTestEvidence(allFiles, rootDirs, packageInfo);
  const ciEvidence = findCiEvidence(lowerFiles);

  const checks = applyCheckConfig([
    buildCheck({
      id: 'readme',
      label: 'README present',
      weight: 12,
      passed: hasRootFileMatching(rootFiles, /^readme(\.|$)/),
      evidence: findRootMatches(rootFiles, /^readme(\.|$)/),
      advice: 'Add README.md with install, usage, examples, and publishing notes.'
    }),
    buildCheck({
      id: 'license',
      label: 'License present',
      weight: 8,
      passed: hasRootFileMatching(rootFiles, /^licen[sc]e(\.|$)/),
      evidence: findRootMatches(rootFiles, /^licen[sc]e(\.|$)/),
      advice: 'Add a LICENSE file so people know how they can use the project.'
    }),
    buildCheck({
      id: 'gitignore',
      label: '.gitignore present',
      weight: 8,
      passed: rootFiles.has('.gitignore'),
      evidence: rootFiles.has('.gitignore') ? ['.gitignore'] : [],
      advice: 'Add .gitignore for dependencies, build output, local env files, and editor noise.'
    }),
    buildCheck({
      id: 'manifest',
      label: 'Dependency manifest present',
      weight: 10,
      passed: manifests.length > 0,
      evidence: manifests,
      advice: `Add one of: ${MANIFESTS.join(', ')}.`
    }),
    buildCheck({
      id: 'lockfile',
      label: 'Lockfile present',
      weight: 6,
      passed: !lockfileNeeded || lockfiles.length > 0,
      evidence: lockfiles.length > 0 ? lockfiles : !lockfileNeeded ? ['No third-party dependencies found'] : [],
      advice: `Commit the matching lockfile when the project uses dependencies: ${LOCKFILES.join(', ')}.`
    }),
    buildCheck({
      id: 'tests',
      label: 'Tests or test script present',
      weight: 12,
      passed: testEvidence.length > 0,
      evidence: testEvidence,
      advice: 'Add a test script, a tests directory, or files named *.test.* / *.spec.*.'
    }),
    buildCheck({
      id: 'ci',
      label: 'CI workflow present',
      weight: 10,
      passed: ciEvidence.length > 0,
      evidence: ciEvidence,
      advice: 'Add a GitHub Actions workflow or another CI config that runs tests on pull requests.'
    }),
    buildCheck({
      id: 'env-hygiene',
      label: 'No private env files committed',
      weight: 10,
      passed: sensitiveEnvFiles.length === 0,
      evidence: sensitiveEnvFiles,
      advice: 'Remove committed .env files, rotate any exposed credentials, and keep only example templates.'
    }),
    buildCheck({
      id: 'env-template',
      label: 'Environment template documented',
      weight: 6,
      passed: sensitiveEnvFiles.length === 0 || envExamples.length > 0,
      evidence: envExamples.length > 0 ? envExamples : sensitiveEnvFiles.length === 0 ? ['No private env files found'] : [],
      advice: 'Add .env.example, .env.sample, or .env.template with placeholder values only.'
    }),
    buildCheck({
      id: 'secret-scan',
      label: 'No obvious secrets in text files',
      weight: 14,
      passed: secretFindings.length === 0,
      evidence: secretFindings.map((finding) => `${finding.file}:${finding.line} (${finding.type})`),
      advice: 'Remove hard-coded secrets, rotate exposed credentials, and load secrets from runtime configuration.'
    }),
    buildCheck({
      id: 'community-docs',
      label: 'Community or release docs present',
      weight: 4,
      passed: hasRootFileMatching(rootFiles, /^(contributing|changelog|security|code_of_conduct)(\.|$)/),
      evidence: findRootMatches(rootFiles, /^(contributing|changelog|security|code_of_conduct)(\.|$)/),
      advice: 'Add CONTRIBUTING.md, CHANGELOG.md, SECURITY.md, or CODE_OF_CONDUCT.md as the project matures.'
    })
  ], config.checks);

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + check.score, 0);
  const score = totalWeight === 0 ? 100 : Math.round((earned / totalWeight) * 100);

  return {
    tool: 'repo-health-doctor',
    version: VERSION,
    root,
    config: {
      source: config.source,
      failUnder: config.failUnder,
      ignore: config.ignore,
      disabledChecks: config.disabledChecks,
      weightOverrides: config.weightOverrides
    },
    score,
    grade: gradeScore(score),
    passedChecks: checks.filter((check) => check.passed).length,
    totalChecks: checks.length,
    checks,
    findings: {
      sensitiveEnvFiles,
      secretFindings,
      manifests,
      lockfiles
    }
  };
}

function loadConfig(root, explicitConfigPath) {
  const base = {
    source: null,
    failUnder: null,
    ignore: [],
    checks: {},
    disabledChecks: [],
    weightOverrides: {}
  };

  let rawConfig = null;
  let source = null;

  if (explicitConfigPath) {
    source = path.resolve(explicitConfigPath);
    rawConfig = readJsonFile(source, `Config file is not valid JSON: ${source}`);
  } else {
    for (const file of CONFIG_FILES) {
      const candidate = path.join(root, file);
      if (fs.existsSync(candidate)) {
        source = candidate;
        rawConfig = readJsonFile(candidate, `Config file is not valid JSON: ${candidate}`);
        break;
      }
    }

    if (!rawConfig) {
      const packageJson = readJsonFileIfExists(path.join(root, 'package.json'));
      if (packageJson?.repoHealth && typeof packageJson.repoHealth === 'object') {
        source = path.join(root, 'package.json#repoHealth');
        rawConfig = packageJson.repoHealth;
      }
    }
  }

  if (!rawConfig) {
    return base;
  }

  const failUnder = rawConfig.failUnder === undefined ? null : parseThreshold(String(rawConfig.failUnder));
  const ignore = Array.isArray(rawConfig.ignore)
    ? rawConfig.ignore.filter((item) => typeof item === 'string' && item.trim()).map((item) => normalizePathPattern(item))
    : [];
  const checks = normalizeChecksConfig(rawConfig.checks);

  return {
    source,
    failUnder,
    ignore,
    checks,
    disabledChecks: Object.entries(checks).filter(([, value]) => value.enabled === false).map(([id]) => id),
    weightOverrides: Object.fromEntries(
      Object.entries(checks)
        .filter(([, value]) => value.weight !== null)
        .map(([id, value]) => [id, value.weight])
    )
  };
}

function readJsonFile(filePath, message) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Config file does not exist: ${filePath}`);
    }
    throw new Error(message);
  }
}

function readJsonFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeChecksConfig(rawChecks) {
  if (!rawChecks || typeof rawChecks !== 'object' || Array.isArray(rawChecks)) {
    return {};
  }

  const normalized = {};
  for (const [rawId, value] of Object.entries(rawChecks)) {
    const id = normalizeCheckId(rawId);
    if (typeof value === 'boolean') {
      normalized[id] = {
        enabled: value,
        weight: null
      };
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      normalized[id] = {
        enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
        weight: value.weight === undefined ? null : parseWeight(value.weight, id)
      };
    }
  }
  return normalized;
}

function normalizeCheckId(rawId) {
  return String(rawId)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function parseWeight(rawWeight, checkId) {
  const weight = Number(rawWeight);
  if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
    throw new Error(`Config check "${checkId}" weight must be an integer from 0 to 100`);
  }
  return weight;
}

function applyCheckConfig(checks, checkConfig) {
  return checks
    .filter((check) => checkConfig[check.id]?.enabled !== false)
    .map((check) => {
      const override = checkConfig[check.id]?.weight;
      if (override === null || override === undefined) {
        return check;
      }

      return {
        ...check,
        weight: override,
        score: check.passed ? override : 0
      };
    });
}

function parseThreshold(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error('--fail-under must be an integer from 0 to 100');
  }
  return value;
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function collectInventory(root, ignorePatterns = []) {
  const rootEntries = fs.readdirSync(root, { withFileTypes: true });
  const rootFiles = rootEntries
    .filter((entry) => entry.isFile() && !isIgnoredPath(entry.name, ignorePatterns))
    .map((entry) => entry.name);
  const rootDirs = rootEntries
    .filter((entry) => entry.isDirectory() && !isIgnoredPath(`${entry.name}/`, ignorePatterns))
    .map((entry) => entry.name);
  const files = [];

  walk(root, root, files, ignorePatterns);

  return {
    rootFiles,
    rootDirs,
    files
  };
}

function walk(root, currentDir, files, ignorePatterns) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relative = toPosixPath(path.relative(root, fullPath));
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && !isIgnoredPath(`${relative}/`, ignorePatterns)) {
        walk(root, fullPath, files, ignorePatterns);
      }
      continue;
    }

    if (entry.isFile() && !isIgnoredPath(relative, ignorePatterns)) {
      files.push({
        fullPath,
        relative
      });
    }
  }
}

function isIgnoredPath(relativePath, ignorePatterns) {
  return ignorePatterns.some((pattern) => matchesIgnorePattern(relativePath, pattern));
}

function matchesIgnorePattern(relativePath, pattern) {
  const normalizedPath = normalizePathPattern(relativePath);
  const normalizedPattern = normalizePathPattern(pattern);

  if (!normalizedPattern.includes('/')) {
    return path.posix.basename(normalizedPath.replace(/\/$/, '')) === normalizedPattern;
  }

  return wildcardToRegExp(normalizedPattern).test(normalizedPath);
}

function wildcardToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function normalizePathPattern(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function readPackageInfo(root) {
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return {
      scripts: parsed && typeof parsed === 'object' && parsed.scripts ? parsed.scripts : {},
      dependencies: readDependencyNames(parsed)
    };
  } catch {
    return {
      scripts: {},
      dependencies: [],
      parseError: true
    };
  }
}

function readDependencyNames(packageJson) {
  if (!packageJson || typeof packageJson !== 'object') {
    return [];
  }

  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  return sections.flatMap((section) => {
    const value = packageJson[section];
    return value && typeof value === 'object' ? Object.keys(value) : [];
  });
}

function needsLockfile(manifests, packageInfo) {
  if (manifests.length === 0) {
    return false;
  }

  if (manifests.length === 1 && manifests[0] === 'package.json') {
    return (packageInfo?.dependencies ?? []).length > 0;
  }

  return true;
}

function findTestEvidence(allFiles, rootDirs, packageInfo) {
  const evidence = [];
  const scripts = packageInfo?.scripts ?? {};
  if (typeof scripts.test === 'string' && scripts.test.trim()) {
    evidence.push('package.json scripts.test');
  }

  if (rootDirs.has('test')) {
    evidence.push('test/');
  }
  if (rootDirs.has('tests')) {
    evidence.push('tests/');
  }

  const testFile = allFiles.find((file) => /\.(test|spec)\.[cm]?[jt]sx?$|_(test|spec)\.py$/i.test(file));
  if (testFile) {
    evidence.push(testFile);
  }

  return [...new Set(evidence)];
}

function findCiEvidence(lowerFiles) {
  const evidence = [];
  for (const file of lowerFiles) {
    if (/^\.github\/workflows\/.+\.ya?ml$/.test(file)) {
      evidence.push(file);
    }
  }

  for (const file of ['.gitlab-ci.yml', 'azure-pipelines.yml', '.circleci/config.yml']) {
    if (lowerFiles.has(file)) {
      evidence.push(file);
    }
  }

  return evidence;
}

function findSecretFindings(root, files) {
  const findings = [];
  for (const file of files) {
    const basename = path.basename(file.relative);
    if (isSensitiveEnvFile(basename) || shouldSkipContentScan(file.fullPath)) {
      continue;
    }

    const content = safeReadText(file.fullPath);
    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const secret of SECRET_PATTERNS) {
        if (secret.pattern.test(lines[index])) {
          findings.push({
            file: toPosixPath(path.relative(root, file.fullPath)),
            line: index + 1,
            type: secret.label
          });
          break;
        }
      }
    }
  }
  return findings;
}

function shouldSkipContentScan(filePath) {
  const stat = safeStat(filePath);
  if (!stat || stat.size > TEXT_FILE_LIMIT) {
    return true;
  }

  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function safeReadText(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) {
      return null;
    }
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

function isSensitiveEnvFile(basename) {
  const lower = basename.toLowerCase();
  if (!(lower === '.env' || lower.startsWith('.env.'))) {
    return false;
  }
  return !/(example|sample|template|schema|dist)/.test(lower);
}

function isEnvExample(basename) {
  return /^\.env[.\w-]*(example|sample|template|schema|dist)$/i.test(basename);
}

function buildCheck({ id, label, weight, passed, evidence, advice }) {
  return {
    id,
    label,
    weight,
    passed,
    score: passed ? weight : 0,
    evidence,
    advice: passed ? null : advice
  };
}

function hasRootFileMatching(rootFiles, pattern) {
  for (const file of rootFiles) {
    if (pattern.test(file)) {
      return true;
    }
  }
  return false;
}

function findRootMatches(rootFiles, pattern) {
  const matches = [];
  for (const file of rootFiles) {
    if (pattern.test(file)) {
      matches.push(file);
    }
  }
  return matches;
}

function gradeScore(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function formatHumanReport(report) {
  const lines = [
    `Repo Health Doctor ${report.version}`,
    `Repository: ${report.root}`,
    report.config.source ? `Config: ${report.config.source}` : 'Config: none',
    `Score: ${report.score}/100 (grade ${report.grade})`,
    `Checks: ${report.passedChecks}/${report.totalChecks} passed`,
    ''
  ];

  for (const check of report.checks) {
    const status = check.passed ? 'PASS' : 'FAIL';
    lines.push(`[${status}] ${check.label} (${check.score}/${check.weight})`);
    if (check.evidence.length > 0) {
      lines.push(`  Evidence: ${check.evidence.join(', ')}`);
    }
    if (!check.passed) {
      lines.push(`  Fix: ${check.advice}`);
    }
  }

  if (report.findings.secretFindings.length > 0) {
    lines.push('', 'Secret findings do not include secret values:');
    for (const finding of report.findings.secretFindings) {
      lines.push(`- ${finding.file}:${finding.line} (${finding.type})`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function printHelp() {
  return `Repo Health Doctor ${VERSION}

Usage:
  repo-health-doctor [path] [--json] [--config <path>] [--fail-under <score>]
  rhd [path]

Options:
  --json                 Print machine-readable JSON.
  --config <path>        Read config from a JSON file.
  --fail-under <score>   Exit with code 1 when score is below 0-100 threshold.
  -v, --version          Print version.
  -h, --help             Print help.
`;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.version) {
      process.stdout.write(`${VERSION}\n`);
      return;
    }

    if (options.help) {
      process.stdout.write(printHelp());
      return;
    }

    const report = analyzeRepository(options.target, { configPath: options.configPath });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(formatHumanReport(report));
    }

    const failUnder = options.failUnder ?? report.config.failUnder;
    if (failUnder !== null && report.score < failUnder) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 2;
  }
}

const entryUrl = pathToFileURL(process.argv[1] ?? '').href;
if (import.meta.url === entryUrl) {
  main();
}
