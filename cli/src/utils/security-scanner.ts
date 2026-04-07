/**
 * Security Scanner
 *
 * Language-aware, regex-based security scanner for JS/TS, Python, and PHP.
 * Detects common vulnerabilities, assigns severity levels, and provides
 * actionable remediation guidance.
 *
 * Implements: bd-modinsp.3.3 (Security Scanner)
 *
 * Supported checks per language:
 *  JS/TS  – eval, hardcoded credentials, innerHTML/XSS, Function constructor,
 *            string-based setTimeout, prototype pollution, SQL via template literal,
 *            weak hashes, insecure Math.random, HTTP URLs, unhandled rejections
 *  Python – eval/exec, hardcoded credentials, SQL f-string injection, shell=True,
 *            os.system, pickle.loads, weak hashes, insecure random, mktemp
 *  PHP    – eval, hardcoded credentials, XSS echo, SQL concatenation, command
 *            injection, dynamic file inclusion, unserialize, weak hashes,
 *            insecure rand, extract() injection
 */

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Severity levels ordered most → least critical. */
export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Broad vulnerability categories. */
export type SecurityCategory =
  | 'credentials'
  | 'injection'
  | 'xss'
  | 'crypto'
  | 'deserialization'
  | 'file-inclusion'
  | 'insecure-random'
  | 'prototype'
  | 'unhandled-error';

/** Languages the scanner can process. */
export type ScanLanguage = 'javascript' | 'typescript' | 'python' | 'php' | 'unknown';

/** A single security finding within a file. */
export interface SecurityFinding {
  /** Rule identifier e.g. "JSEC001". */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** Detailed description of the detected issue. */
  description: string;
  severity: SecuritySeverity;
  category: SecurityCategory;
  /** 1-based line number. */
  line: number;
  /** 1-based column number (start of match). */
  column: number;
  /** The offending source line, trimmed. */
  snippet: string;
  /** Actionable remediation advice. */
  remediation: string;
}

/** Aggregate counts per severity level. */
export interface SecuritySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/** Full result from scanning one source file. */
export interface SecurityScanResult {
  filePath: string;
  language: ScanLanguage;
  findings: SecurityFinding[];
  scannedAt: string;
  summary: SecuritySummary;
}

// ---------------------------------------------------------------------------
// Internal rule definition
// ---------------------------------------------------------------------------

interface SecurityRule {
  id: string;
  title: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  /** Applied per source line (inline comments already stripped). */
  pattern: RegExp;
  /** If this pattern also matches the line, skip the finding (false-positive guard). */
  excludePattern?: RegExp;
  /** Must also match the line for the finding to be raised. */
  includePattern?: RegExp;
  description: (match: string, snippet: string) => string;
  remediation: string;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const LANGUAGE_MAP: Record<string, ScanLanguage> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python',
  php: 'php', php7: 'php', php8: 'php',
};

function detectScanLanguage(filePath: string): ScanLanguage {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_MAP[ext] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Placeholder suppressor – avoids flagging example / placeholder credential values
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE =
  /placeholder|example|your[-_]?(?:key|token|secret|password|api)?|sample|dummy|fake|test[-_]?(?:key|token|secret)?|changeme|todo|fixme|<[^>]+>|xxx+|\.{4,}|\*{4,}|redacted|put[-_]?your|insert[-_]?your|replace[-_]?(?:with|this)/i;


// ---------------------------------------------------------------------------
// JS / TypeScript Security Rules  (JSEC001 – JSEC012)
// ---------------------------------------------------------------------------

const JS_TS_RULES: SecurityRule[] = [
  {
    id: 'JSEC001',
    title: 'Direct eval() usage',
    category: 'injection',
    severity: 'high',
    pattern: /\beval\s*\(/,
    description: (_m, s) => `eval() found: "${s.trim()}"`,
    remediation:
      'Avoid eval(). Use JSON.parse() for JSON data, or refactor to eliminate dynamic code execution.',
  },
  {
    id: 'JSEC002',
    title: 'Hardcoded credential',
    category: 'credentials',
    severity: 'critical',
    pattern:
      /(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[=:]\s*['"`][^'"`]{8,}['"`]/i,
    excludePattern: PLACEHOLDER_RE,
    description: (_m, s) => `Hardcoded credential detected: "${s.trim()}"`,
    remediation:
      'Store credentials in environment variables (process.env) or a secrets manager, never in source code.',
  },
  {
    id: 'JSEC003',
    title: 'Dangerous innerHTML / outerHTML assignment (XSS)',
    category: 'xss',
    severity: 'high',
    pattern: /\.(?:inner|outer)HTML\s*=/,
    description: (_m, s) => `Unsafe HTML assignment: "${s.trim()}"`,
    remediation:
      'Use textContent for plain text. For HTML, sanitize with DOMPurify before assigning to innerHTML.',
  },
  {
    id: 'JSEC004',
    title: 'document.write() usage (XSS)',
    category: 'xss',
    severity: 'medium',
    pattern: /document\.write\s*\(/,
    description: (_m, s) => `document.write() usage: "${s.trim()}"`,
    remediation:
      'Avoid document.write(). Use DOM APIs (createElement, appendChild) instead.',
  },
  {
    id: 'JSEC005',
    title: 'Function constructor (code injection)',
    category: 'injection',
    severity: 'high',
    pattern: /new\s+Function\s*\(/,
    description: (_m, s) => `Function constructor found: "${s.trim()}"`,
    remediation:
      'Avoid the Function constructor; it executes arbitrary code. Use named functions or closures.',
  },
  {
    id: 'JSEC006',
    title: 'setTimeout / setInterval with string argument',
    category: 'injection',
    severity: 'medium',
    pattern: /\b(?:setTimeout|setInterval)\s*\(\s*[`'"]/,
    description: (_m, s) => `String-based timer call: "${s.trim()}"`,
    remediation:
      'Pass a function reference to setTimeout/setInterval rather than a string to prevent implicit eval.',
  },
  {
    id: 'JSEC007',
    title: 'Prototype pollution',
    category: 'prototype',
    severity: 'high',
    pattern: /\.__proto__\s*=|Object\.prototype\s*\[/,
    description: (_m, s) => `Prototype modification: "${s.trim()}"`,
    remediation:
      'Avoid modifying __proto__ or Object.prototype. Use Object.create(null) for safe property bags.',
  },
  {
    id: 'JSEC008',
    title: 'SQL injection via template literal',
    category: 'injection',
    severity: 'high',
    pattern: /(?:\.query|\.execute|pool\.query|db\.run)\s*\(\s*[`].*\$\{/,
    description: (_m, s) => `Interpolated SQL query: "${s.trim()}"`,
    remediation:
      'Use parameterized queries (?, $1 placeholders) instead of string interpolation in SQL.',
  },
  {
    id: 'JSEC009',
    title: 'Weak hash algorithm',
    category: 'crypto',
    severity: 'medium',
    pattern: /createHash\s*\(\s*['"`](?:md5|sha1)['"`]\s*\)/i,
    description: (_m, s) => `Weak hash algorithm: "${s.trim()}"`,
    remediation: 'Replace MD5 / SHA-1 with SHA-256 or stronger: crypto.createHash("sha256").',
  },
  {
    id: 'JSEC010',
    title: 'Insecure random for security-sensitive value',
    category: 'insecure-random',
    severity: 'medium',
    pattern: /(?:token|key|secret|nonce|salt|csrf|password|session)\s*=.*Math\.random\s*\(/i,
    description: (_m, s) => `Math.random() for security-sensitive value: "${s.trim()}"`,
    remediation:
      'Use crypto.randomBytes() or crypto.getRandomValues() for cryptographically secure random values.',
  },
  {
    id: 'JSEC011',
    title: 'HTTP instead of HTTPS',
    category: 'injection',
    severity: 'low',
    pattern: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/,
    description: (_m, s) => `Plain HTTP URL: "${s.trim()}"`,
    remediation:
      'Use HTTPS for all external connections to prevent man-in-the-middle attacks.',
  },
  {
    id: 'JSEC012',
    title: 'Unhandled promise rejection',
    category: 'unhandled-error',
    severity: 'low',
    pattern: /\.then\s*\([^)]*\)\s*;/,
    excludePattern: /\.catch\s*\(/,
    description: (_m, s) => `Promise .then() without .catch(): "${s.trim()}"`,
    remediation:
      'Chain .catch() after .then(), or use try/catch with async/await to handle rejections.',
  },
];


// ---------------------------------------------------------------------------
// Python Security Rules  (PSEC001 – PSEC009)
// ---------------------------------------------------------------------------

const PYTHON_RULES: SecurityRule[] = [
  {
    id: 'PSEC001',
    title: 'eval() / exec() usage',
    category: 'injection',
    severity: 'high',
    pattern: /\b(?:eval|exec)\s*\(/,
    description: (_m, s) => `Dynamic code execution: "${s.trim()}"`,
    remediation:
      'Avoid eval/exec. Use ast.literal_eval() for safe literal parsing, or refactor to eliminate dynamic execution.',
  },
  {
    id: 'PSEC002',
    title: 'Hardcoded credential',
    category: 'credentials',
    severity: 'critical',
    pattern:
      /(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key)\s*=\s*['"][^'"]{8,}['"]/i,
    excludePattern: PLACEHOLDER_RE,
    description: (_m, s) => `Hardcoded credential detected: "${s.trim()}"`,
    remediation:
      'Use os.environ or a secrets manager. Never store credentials in source code.',
  },
  {
    id: 'PSEC003',
    title: 'SQL injection via f-string or concatenation',
    category: 'injection',
    severity: 'high',
    pattern:
      /(?:cursor\.execute|session\.execute|db\.execute|connection\.execute)\s*\(\s*(?:f['"]|['"][^'"]*\+\s*\w)/,
    description: (_m, s) => `Possible SQL injection: "${s.trim()}"`,
    remediation:
      'Use parameterized queries: cursor.execute("SELECT ... WHERE id = %s", (value,))',
  },
  {
    id: 'PSEC004',
    title: 'Command injection via shell=True',
    category: 'injection',
    severity: 'critical',
    pattern: /subprocess\s*\.\s*(?:call|run|Popen|check_output)\s*\([^)]*shell\s*=\s*True/,
    description: (_m, s) => `shell=True in subprocess call: "${s.trim()}"`,
    remediation:
      'Avoid shell=True. Pass command as a list: subprocess.run(["cmd", "arg"]).',
  },
  {
    id: 'PSEC005',
    title: 'os.system() usage (command injection)',
    category: 'injection',
    severity: 'high',
    pattern: /\bos\.system\s*\(/,
    description: (_m, s) => `os.system() found: "${s.trim()}"`,
    remediation:
      'Replace os.system() with subprocess.run() with a list of arguments and shell=False.',
  },
  {
    id: 'PSEC006',
    title: 'Pickle deserialization',
    category: 'deserialization',
    severity: 'high',
    pattern: /\bpickle\s*\.\s*(?:load|loads)\s*\(/,
    description: (_m, s) => `pickle.loads/load() found: "${s.trim()}"`,
    remediation:
      'Never unpickle data from untrusted sources. Use JSON or a safe serialization format.',
  },
  {
    id: 'PSEC007',
    title: 'Weak hash algorithm',
    category: 'crypto',
    severity: 'medium',
    pattern: /hashlib\s*\.\s*(?:md5|sha1)\s*\(/i,
    description: (_m, s) => `Weak hash algorithm: "${s.trim()}"`,
    remediation:
      'Replace MD5/SHA-1 with hashlib.sha256() or stronger. For passwords, use hashlib.scrypt() or bcrypt.',
  },
  {
    id: 'PSEC008',
    title: 'Insecure random for security-sensitive value',
    category: 'insecure-random',
    severity: 'medium',
    pattern:
      /(?:token|key|secret|nonce|salt|csrf|password|session)\s*=.*random\s*\.\s*(?:random|randint|choice|randbytes)\s*\(/i,
    description: (_m, s) => `random module for security-sensitive value: "${s.trim()}"`,
    remediation:
      'Use the secrets module (secrets.token_hex(), secrets.token_bytes()) or os.urandom() for security-sensitive values.',
  },
  {
    id: 'PSEC009',
    title: 'Insecure temporary file (race condition)',
    category: 'injection',
    severity: 'low',
    pattern: /tempfile\s*\.\s*mktemp\s*\(/,
    description: (_m, s) => `tempfile.mktemp() found: "${s.trim()}"`,
    remediation:
      'Use tempfile.mkstemp() or tempfile.TemporaryFile() instead of mktemp() to avoid TOCTOU race conditions.',
  },
];

// ---------------------------------------------------------------------------
// PHP Security Rules  (PHPSEC001 – PHPSEC010)
// ---------------------------------------------------------------------------

const PHP_RULES: SecurityRule[] = [
  {
    id: 'PHPSEC001',
    title: 'eval() usage',
    category: 'injection',
    severity: 'high',
    pattern: /\beval\s*\(/,
    description: (_m, s) => `eval() found: "${s.trim()}"`,
    remediation:
      'Avoid eval(). Refactor to use static logic or safe data parsing.',
  },
  {
    id: 'PHPSEC002',
    title: 'Hardcoded credential',
    category: 'credentials',
    severity: 'critical',
    pattern:
      /\$(?:password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key)\s*=\s*['"][^'"]{8,}['"]/i,
    excludePattern: PLACEHOLDER_RE,
    description: (_m, s) => `Hardcoded credential detected: "${s.trim()}"`,
    remediation:
      'Use environment variables ($_ENV, getenv()) or a config file outside the web root.',
  },
  {
    id: 'PHPSEC003',
    title: 'XSS via unescaped user input in output',
    category: 'xss',
    severity: 'high',
    pattern: /(?:echo|print)\s+\$_(?:GET|POST|REQUEST|SERVER|COOKIE)/,
    description: (_m, s) => `Unescaped user input in output: "${s.trim()}"`,
    remediation:
      'Wrap user input with htmlspecialchars($value, ENT_QUOTES, "UTF-8") before echoing.',
  },
  {
    id: 'PHPSEC004',
    title: 'SQL injection via string concatenation',
    category: 'injection',
    severity: 'high',
    pattern:
      /(?:mysql_query|mysqli_query)\s*\([^)]*\.\s*\$|['"][A-Z\s]*(?:SELECT|INSERT|UPDATE|DELETE)\s+[^'"]*['"]\s*\.\s*\$/i,
    description: (_m, s) => `SQL query with string concatenation: "${s.trim()}"`,
    remediation:
      'Use PDO or MySQLi with prepared statements and bound parameters.',
  },
  {
    id: 'PHPSEC005',
    title: 'Command injection via shell function',
    category: 'injection',
    severity: 'critical',
    pattern: /\b(?:exec|shell_exec|system|passthru|popen)\s*\([^)]*\$/,
    description: (_m, s) => `Shell command with variable argument: "${s.trim()}"`,
    remediation:
      'Avoid executing shell commands with user-supplied input. Use escapeshellarg() and escapeshellcmd() if unavoidable.',
  },
  {
    id: 'PHPSEC006',
    title: 'Dynamic file inclusion with user input',
    category: 'file-inclusion',
    severity: 'critical',
    pattern: /\b(?:include|require)(?:_once)?\s*\(?\s*\$_(?:GET|POST|REQUEST|COOKIE|SERVER)/,
    description: (_m, s) => `User-controlled file inclusion: "${s.trim()}"`,
    remediation:
      'Never include files based on user input. Use a whitelist of allowed filenames.',
  },
  {
    id: 'PHPSEC007',
    title: 'Unserialize with user input',
    category: 'deserialization',
    severity: 'high',
    pattern: /unserialize\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/,
    description: (_m, s) => `Unserializing user input: "${s.trim()}"`,
    remediation:
      'Avoid unserialize() with untrusted data. Use JSON (json_decode()) as a safe alternative.',
  },
  {
    id: 'PHPSEC008',
    title: 'Weak hash algorithm',
    category: 'crypto',
    severity: 'medium',
    pattern: /\b(?:md5|sha1)\s*\(/,
    description: (_m, s) => `Weak hash function: "${s.trim()}"`,
    remediation:
      'For passwords use password_hash(). For data integrity use hash("sha256", ...) or stronger.',
  },
  {
    id: 'PHPSEC009',
    title: 'Insecure random for security-sensitive value',
    category: 'insecure-random',
    severity: 'medium',
    pattern: /(?:token|key|secret|nonce|salt|csrf|password|session)\s*=.*\b(?:rand|mt_rand)\s*\(/i,
    description: (_m, s) => `Insecure PRNG for security-sensitive value: "${s.trim()}"`,
    remediation:
      'Use random_bytes() or random_int() for cryptographically secure random values in PHP.',
  },
  {
    id: 'PHPSEC010',
    title: 'extract() with user input (variable injection)',
    category: 'injection',
    severity: 'high',
    pattern: /\bextract\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/,
    description: (_m, s) => `extract() from user input: "${s.trim()}"`,
    remediation:
      'Never use extract() with user-supplied arrays. Explicitly assign only the variables you need.',
  },
];


// ---------------------------------------------------------------------------
// Inline-comment stripping helpers  (line-level, best-effort)
// ---------------------------------------------------------------------------

/** Strip // line comment from a JS/TS line, respecting string boundaries. */
function stripJsTsComment(line: string): string {
  const idx = line.indexOf('//');
  if (idx === -1) return line;
  const before = line.substring(0, idx);
  const sq = (before.match(/'/g) ?? []).length;
  const dq = (before.match(/"/g) ?? []).length;
  const bt = (before.match(/`/g) ?? []).length;
  if (sq % 2 !== 0 || dq % 2 !== 0 || bt % 2 !== 0) return line;
  return before;
}

/** Strip # line comment from a Python line, respecting string boundaries. */
function stripPythonComment(line: string): string {
  const idx = line.indexOf('#');
  if (idx === -1) return line;
  const before = line.substring(0, idx);
  const sq = (before.match(/'/g) ?? []).length;
  const dq = (before.match(/"/g) ?? []).length;
  if (sq % 2 !== 0 || dq % 2 !== 0) return line;
  return before;
}

/** Strip // or # comment from a PHP line, respecting string boundaries. */
function stripPhpComment(line: string): string {
  for (const marker of ['//', '#']) {
    const idx = line.indexOf(marker);
    if (idx !== -1) {
      const before = line.substring(0, idx);
      const sq = (before.match(/'/g) ?? []).length;
      const dq = (before.match(/"/g) ?? []).length;
      if (sq % 2 === 0 && dq % 2 === 0) return before;
    }
  }
  return line;
}

// ---------------------------------------------------------------------------
// Core scan engine
// ---------------------------------------------------------------------------

function buildSummary(findings: SecurityFinding[]): SecuritySummary {
  const s: SecuritySummary = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) s[f.severity]++;
  return s;
}

function applyRules(
  lines: string[],
  rules: SecurityRule[],
  stripComment: (line: string) => string,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const stripped = stripComment(rawLine);

    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(stripped);
      if (!match) continue;

      // False-positive guard: skip if exclude pattern matches
      if (rule.excludePattern) {
        rule.excludePattern.lastIndex = 0;
        if (rule.excludePattern.test(stripped)) continue;
      }

      // Additional context requirement: skip if include pattern is absent
      if (rule.includePattern) {
        rule.includePattern.lastIndex = 0;
        if (!rule.includePattern.test(stripped)) continue;
      }

      findings.push({
        id: rule.id,
        title: rule.title,
        category: rule.category,
        severity: rule.severity,
        line: i + 1,
        column: match.index + 1,
        snippet: rawLine.trim(),
        description: rule.description(match[0], rawLine),
        remediation: rule.remediation,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Public scanning API
// ---------------------------------------------------------------------------

/**
 * Scan a single source file for security vulnerabilities.
 *
 * @param filePath  Path to the file (used for language detection; file is not read here).
 * @param content   Raw source content.
 * @returns         {@link SecurityScanResult} with all findings and a severity summary.
 */
export function scanFile(filePath: string, content: string): SecurityScanResult {
  const language = detectScanLanguage(filePath);
  const lines = content.split('\n');

  let findings: SecurityFinding[];
  if (language === 'javascript' || language === 'typescript') {
    findings = applyRules(lines, JS_TS_RULES, stripJsTsComment);
  } else if (language === 'python') {
    findings = applyRules(lines, PYTHON_RULES, stripPythonComment);
  } else if (language === 'php') {
    findings = applyRules(lines, PHP_RULES, stripPhpComment);
  } else {
    findings = [];
  }

  return {
    filePath,
    language,
    findings,
    scannedAt: new Date().toISOString(),
    summary: buildSummary(findings),
  };
}

/**
 * Scan multiple { filePath, content } pairs and return one result per file.
 */
export function scanFiles(
  files: Array<{ filePath: string; content: string }>,
): SecurityScanResult[] {
  return files.map(({ filePath, content }) => scanFile(filePath, content));
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: SecuritySeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

function sortedFindings(findings: SecurityFinding[]): SecurityFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

function formatText(result: SecurityScanResult): string {
  const lines: string[] = [];
  const s = result.summary;
  lines.push(`Security Scan: ${result.filePath}`);
  lines.push(`Language: ${result.language}  |  Scanned: ${result.scannedAt}`);
  lines.push(
    `Findings: ${s.total} total  —  ${s.critical} critical, ${s.high} high, ` +
    `${s.medium} medium, ${s.low} low, ${s.info} info`,
  );
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('✔ No security issues detected.');
    return lines.join('\n');
  }

  for (const f of sortedFindings(result.findings)) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.id} – ${f.title}`);
    lines.push(`  Line ${f.line}:${f.column}  ${f.description}`);
    lines.push(`  Snippet:  ${f.snippet}`);
    lines.push(`  Fix:      ${f.remediation}`);
    lines.push('');
  }

  return lines.join('\n');
}


function formatMarkdown(result: SecurityScanResult): string {
  const lines: string[] = [];
  const s = result.summary;

  lines.push('# Security Scan Report');
  lines.push('');
  lines.push(`**File:** \`${result.filePath}\`  `);
  lines.push(`**Language:** ${result.language}  `);
  lines.push(`**Scanned:** ${result.scannedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  for (const sev of SEVERITY_ORDER) {
    lines.push(`| ${sev} | ${s[sev]} |`);
  }
  lines.push(`| **Total** | **${s.total}** |`);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('✔ No security issues detected.');
    return lines.join('\n');
  }

  lines.push('## Findings Overview');
  lines.push('');
  lines.push('| ID | Severity | Category | Line | Title |');
  lines.push('|----|----------|----------|------|-------|');
  for (const f of result.findings) {
    lines.push(`| ${f.id} | ${f.severity} | ${f.category} | ${f.line} | ${f.title} |`);
  }
  lines.push('');

  lines.push('## Detailed Findings');
  lines.push('');
  for (const f of sortedFindings(result.findings)) {
    lines.push(`### ${f.id} – ${f.title} \`[${f.severity.toUpperCase()}]\``);
    lines.push('');
    lines.push(`**Category:** ${f.category}  `);
    lines.push(`**Location:** Line ${f.line}, Column ${f.column}`);
    lines.push('');
    lines.push(`**Description:** ${f.description}`);
    lines.push('');
    lines.push('```');
    lines.push(f.snippet);
    lines.push('```');
    lines.push('');
    lines.push(`**Remediation:** ${f.remediation}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public format function
// ---------------------------------------------------------------------------

/**
 * Format a {@link SecurityScanResult} as plain text, JSON, or Markdown.
 *
 * @param result  The scan result to format.
 * @param format  Target format (default: `'text'`).
 */
export function formatSecurityReport(
  result: SecurityScanResult,
  format: 'text' | 'json' | 'markdown' = 'text',
): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  if (format === 'markdown') return formatMarkdown(result);
  return formatText(result);
}

// ---------------------------------------------------------------------------
// SecurityScanner class  (for handler / plugin integration)
// ---------------------------------------------------------------------------

/**
 * Object-oriented façade around the functional scanning API.
 * Suitable for use with the inspection handler system and VS Code extension.
 */
export class SecurityScanner {
  /**
   * Scan a file by reading it from disk.
   *
   * @param filePath  Absolute path to the source file.
   */
  static async scanFilePath(filePath: string): Promise<SecurityScanResult> {
    const { readFileSync } = await import('fs');
    const content = readFileSync(filePath, 'utf-8');
    return scanFile(filePath, content);
  }

  /**
   * Scan raw source content with an explicit file path for language detection.
   */
  static scan(filePath: string, content: string): SecurityScanResult {
    return scanFile(filePath, content);
  }

  /**
   * Format a scan result.
   */
  static format(
    result: SecurityScanResult,
    format: 'text' | 'json' | 'markdown' = 'text',
  ): string {
    return formatSecurityReport(result, format);
  }

  /**
   * Return only findings at or above the given severity threshold.
   */
  static filterBySeverity(
    result: SecurityScanResult,
    minSeverity: SecuritySeverity,
  ): SecurityFinding[] {
    const threshold = SEVERITY_ORDER.indexOf(minSeverity);
    return result.findings.filter(
      f => SEVERITY_ORDER.indexOf(f.severity) <= threshold,
    );
  }
}
