/**
 * Unit tests – Security Scanner  (bd-modinsp.3.3)
 *
 * All tests are pure in-memory (no file I/O).
 * Verifies: detection of all specified security issues, correct severity levels,
 * actionable remediation text, and no false positives on benign test cases.
 */

import { describe, it, expect } from '@jest/globals';
import { scanFile, scanFiles, formatSecurityReport, SecurityScanner } from '../../utils/security-scanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const scan = (ext: string, content: string) => scanFile(`/fixture/file.${ext}`, content);
const hasId = (ids: string[], id: string) => ids.includes(id);

// ---------------------------------------------------------------------------
// Language detection & unknown type
// ---------------------------------------------------------------------------

describe('Language detection', () => {
  it('returns "unknown" language for unsupported extension', () => {
    const r = scanFile('/fixture/file.rb', '');
    expect(r.language).toBe('unknown');
    expect(r.findings).toHaveLength(0);
  });

  it('detects .ts as typescript', () => {
    expect(scan('ts', '').language).toBe('typescript');
  });

  it('detects .js as javascript', () => {
    expect(scan('js', '').language).toBe('javascript');
  });

  it('detects .py as python', () => {
    expect(scan('py', '').language).toBe('python');
  });

  it('detects .php as php', () => {
    expect(scan('php', '').language).toBe('php');
  });
});

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

describe('Summary', () => {
  it('returns zero counts when no findings', () => {
    const r = scan('ts', 'const x = 1;');
    expect(r.summary.total).toBe(0);
    expect(r.summary.critical).toBe(0);
  });

  it('counts findings by severity correctly', () => {
    const r = scan('ts', [
      `const password = "SuperSecret99!";`,     // JSEC002 critical
      `element.innerHTML = userInput;`,          // JSEC003 high
      `document.write(data);`,                  // JSEC004 medium
    ].join('\n'));
    expect(r.summary.critical).toBeGreaterThanOrEqual(1);
    expect(r.summary.high).toBeGreaterThanOrEqual(1);
    expect(r.summary.medium).toBeGreaterThanOrEqual(1);
    expect(r.summary.total).toBe(r.summary.critical + r.summary.high + r.summary.medium + r.summary.low + r.summary.info);
  });
});

// ---------------------------------------------------------------------------
// JS / TypeScript rules
// ---------------------------------------------------------------------------

describe('JS/TS – eval() (JSEC001)', () => {
  it('flags eval() call', () => {
    const r = scan('ts', `const result = eval(userCode);`);
    const ids = r.findings.map(f => f.id);
    expect(hasId(ids, 'JSEC001')).toBe(true);
    expect(r.findings.find(f => f.id === 'JSEC001')?.severity).toBe('high');
  });

  it('does NOT flag commented-out eval', () => {
    const r = scan('ts', `// eval(code);`);
    expect(r.findings.find(f => f.id === 'JSEC001')).toBeUndefined();
  });
});

describe('JS/TS – hardcoded credentials (JSEC002)', () => {
  it('flags password literal assignment', () => {
    const r = scan('ts', `const password = "MyP@ssword!123";`);
    expect(r.findings.find(f => f.id === 'JSEC002')).toBeDefined();
    expect(r.findings.find(f => f.id === 'JSEC002')?.severity).toBe('critical');
  });

  it('flags api_key assignment', () => {
    const r = scan('ts', `const api_key = "sk-abcdefghij1234567890";`);
    expect(r.findings.find(f => f.id === 'JSEC002')).toBeDefined();
  });

  it('does NOT flag placeholder values', () => {
    const r = scan('ts', `const password = "your_password_here";`);
    expect(r.findings.find(f => f.id === 'JSEC002')).toBeUndefined();
  });

  it('does NOT flag example/placeholder tokens', () => {
    const r = scan('ts', `const apiKey = "example-api-key-placeholder";`);
    expect(r.findings.find(f => f.id === 'JSEC002')).toBeUndefined();
  });
});

describe('JS/TS – innerHTML XSS (JSEC003)', () => {
  it('flags innerHTML assignment', () => {
    const r = scan('js', `container.innerHTML = userInput;`);
    expect(r.findings.find(f => f.id === 'JSEC003')).toBeDefined();
  });

  it('flags outerHTML assignment', () => {
    const r = scan('js', `el.outerHTML = template;`);
    expect(r.findings.find(f => f.id === 'JSEC003')).toBeDefined();
  });
});

describe('JS/TS – document.write() XSS (JSEC004)', () => {
  it('flags document.write', () => {
    const r = scan('js', `document.write('<script>' + code + '</script>');`);
    expect(r.findings.find(f => f.id === 'JSEC004')).toBeDefined();
    expect(r.findings.find(f => f.id === 'JSEC004')?.severity).toBe('medium');
  });
});

describe('JS/TS – Function constructor (JSEC005)', () => {
  it('flags new Function()', () => {
    const r = scan('ts', `const fn = new Function('return 42');`);
    expect(r.findings.find(f => f.id === 'JSEC005')).toBeDefined();
  });
});

describe('JS/TS – string-based setTimeout (JSEC006)', () => {
  it('flags setTimeout with string literal', () => {
    const r = scan('ts', `setTimeout("doSomething()", 1000);`);
    expect(r.findings.find(f => f.id === 'JSEC006')).toBeDefined();
  });

  it('does NOT flag setTimeout with function reference', () => {
    const r = scan('ts', `setTimeout(doSomething, 1000);`);
    expect(r.findings.find(f => f.id === 'JSEC006')).toBeUndefined();
  });
});


describe('JS/TS – prototype pollution (JSEC007)', () => {
  it('flags __proto__ assignment', () => {
    const r = scan('ts', `obj.__proto__ = payload;`);
    expect(r.findings.find(f => f.id === 'JSEC007')).toBeDefined();
    expect(r.findings.find(f => f.id === 'JSEC007')?.severity).toBe('high');
  });

  it('flags Object.prototype bracket assignment', () => {
    const r = scan('ts', `Object.prototype['toString'] = malicious;`);
    expect(r.findings.find(f => f.id === 'JSEC007')).toBeDefined();
  });
});

describe('JS/TS – SQL injection via template literal (JSEC008)', () => {
  it('flags template literal in .query()', () => {
    const r = scan('ts', 'db.query(`SELECT * FROM users WHERE id = ${id}`);');
    expect(r.findings.find(f => f.id === 'JSEC008')).toBeDefined();
  });
});

describe('JS/TS – weak hash (JSEC009)', () => {
  it('flags createHash("md5")', () => {
    const r = scan('ts', `const h = crypto.createHash("md5");`);
    expect(r.findings.find(f => f.id === 'JSEC009')).toBeDefined();
    expect(r.findings.find(f => f.id === 'JSEC009')?.severity).toBe('medium');
  });

  it('flags createHash("sha1")', () => {
    const r = scan('ts', `const h = crypto.createHash('sha1');`);
    expect(r.findings.find(f => f.id === 'JSEC009')).toBeDefined();
  });

  it('does NOT flag createHash("sha256")', () => {
    const r = scan('ts', `const h = crypto.createHash('sha256');`);
    expect(r.findings.find(f => f.id === 'JSEC009')).toBeUndefined();
  });
});

describe('JS/TS – insecure Math.random (JSEC010)', () => {
  it('flags Math.random for token generation', () => {
    const r = scan('ts', `const token = Math.random().toString(36);`);
    expect(r.findings.find(f => f.id === 'JSEC010')).toBeDefined();
  });

  it('does NOT flag Math.random for non-security usage', () => {
    const r = scan('ts', `const x = Math.random();`);
    expect(r.findings.find(f => f.id === 'JSEC010')).toBeUndefined();
  });
});

describe('JS/TS – HTTP URL (JSEC011)', () => {
  it('flags http:// in string', () => {
    const r = scan('ts', `const url = "http://api.example.com/data";`);
    expect(r.findings.find(f => f.id === 'JSEC011')).toBeDefined();
    expect(r.findings.find(f => f.id === 'JSEC011')?.severity).toBe('low');
  });

  it('does NOT flag http://localhost', () => {
    const r = scan('ts', `const url = "http://localhost:3000";`);
    expect(r.findings.find(f => f.id === 'JSEC011')).toBeUndefined();
  });
});

describe('JS/TS – unhandled promise rejection (JSEC012)', () => {
  it('flags .then() without .catch() on same line', () => {
    const r = scan('ts', `fetchData().then(process);`);
    expect(r.findings.find(f => f.id === 'JSEC012')).toBeDefined();
  });

  it('does NOT flag .then().catch() chain', () => {
    const r = scan('ts', `fetchData().then(process).catch(handleError);`);
    expect(r.findings.find(f => f.id === 'JSEC012')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Python rules
// ---------------------------------------------------------------------------

describe('Python – eval/exec (PSEC001)', () => {
  it('flags eval()', () => {
    const r = scan('py', `result = eval(user_input)`);
    expect(r.findings.find(f => f.id === 'PSEC001')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PSEC001')?.severity).toBe('high');
  });

  it('flags exec()', () => {
    const r = scan('py', `exec(code_string)`);
    expect(r.findings.find(f => f.id === 'PSEC001')).toBeDefined();
  });
});

describe('Python – hardcoded credentials (PSEC002)', () => {
  it('flags hardcoded password', () => {
    const r = scan('py', `password = "S3cur3P@$$w0rd!"`);
    expect(r.findings.find(f => f.id === 'PSEC002')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PSEC002')?.severity).toBe('critical');
  });

  it('does NOT flag placeholder', () => {
    const r = scan('py', `password = "your_password_here"`);
    expect(r.findings.find(f => f.id === 'PSEC002')).toBeUndefined();
  });
});

describe('Python – SQL injection (PSEC003)', () => {
  it('flags f-string in cursor.execute', () => {
    const r = scan('py', `cursor.execute(f"SELECT * FROM users WHERE id={uid}")`);
    expect(r.findings.find(f => f.id === 'PSEC003')).toBeDefined();
  });
});

describe('Python – shell=True (PSEC004)', () => {
  it('flags subprocess.run with shell=True', () => {
    const r = scan('py', `subprocess.run(cmd, shell=True)`);
    expect(r.findings.find(f => f.id === 'PSEC004')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PSEC004')?.severity).toBe('critical');
  });

  it('does NOT flag subprocess.run without shell=True', () => {
    const r = scan('py', `subprocess.run(["ls", "-la"])`);
    expect(r.findings.find(f => f.id === 'PSEC004')).toBeUndefined();
  });
});

describe('Python – os.system (PSEC005)', () => {
  it('flags os.system()', () => {
    const r = scan('py', `os.system("rm -rf " + path)`);
    expect(r.findings.find(f => f.id === 'PSEC005')).toBeDefined();
  });
});

describe('Python – pickle deserialization (PSEC006)', () => {
  it('flags pickle.loads()', () => {
    const r = scan('py', `data = pickle.loads(request.body)`);
    expect(r.findings.find(f => f.id === 'PSEC006')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PSEC006')?.severity).toBe('high');
  });
});

describe('Python – weak hash (PSEC007)', () => {
  it('flags hashlib.md5()', () => {
    const r = scan('py', `digest = hashlib.md5(data).hexdigest()`);
    expect(r.findings.find(f => f.id === 'PSEC007')).toBeDefined();
  });

  it('does NOT flag hashlib.sha256()', () => {
    const r = scan('py', `digest = hashlib.sha256(data).hexdigest()`);
    expect(r.findings.find(f => f.id === 'PSEC007')).toBeUndefined();
  });
});

describe('Python – insecure random (PSEC008)', () => {
  it('flags random.random() for token', () => {
    const r = scan('py', `token = str(random.random())`);
    expect(r.findings.find(f => f.id === 'PSEC008')).toBeDefined();
  });
});

describe('Python – mktemp (PSEC009)', () => {
  it('flags tempfile.mktemp()', () => {
    const r = scan('py', `tmpfile = tempfile.mktemp(suffix=".tmp")`);
    expect(r.findings.find(f => f.id === 'PSEC009')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PSEC009')?.severity).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// PHP rules
// ---------------------------------------------------------------------------

describe('PHP – eval (PHPSEC001)', () => {
  it('flags eval()', () => {
    const r = scan('php', `eval($userCode);`);
    expect(r.findings.find(f => f.id === 'PHPSEC001')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PHPSEC001')?.severity).toBe('high');
  });
});

describe('PHP – hardcoded credential (PHPSEC002)', () => {
  it('flags hardcoded $password', () => {
    const r = scan('php', `$password = "Secr3tPass!99";`);
    expect(r.findings.find(f => f.id === 'PHPSEC002')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PHPSEC002')?.severity).toBe('critical');
  });
});

describe('PHP – XSS echo (PHPSEC003)', () => {
  it('flags echo $_GET without escaping', () => {
    const r = scan('php', `echo $_GET['name'];`);
    expect(r.findings.find(f => f.id === 'PHPSEC003')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PHPSEC003')?.severity).toBe('high');
  });
});

describe('PHP – command injection (PHPSEC005)', () => {
  it('flags exec with variable', () => {
    const r = scan('php', `exec("ls " . $userDir);`);
    expect(r.findings.find(f => f.id === 'PHPSEC005')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PHPSEC005')?.severity).toBe('critical');
  });
});

describe('PHP – file inclusion (PHPSEC006)', () => {
  it('flags include from $_GET', () => {
    const r = scan('php', `include($_GET['page']);`);
    expect(r.findings.find(f => f.id === 'PHPSEC006')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PHPSEC006')?.severity).toBe('critical');
  });
});

describe('PHP – unserialize user input (PHPSEC007)', () => {
  it('flags unserialize from $_POST', () => {
    const r = scan('php', `$obj = unserialize($_POST['data']);`);
    expect(r.findings.find(f => f.id === 'PHPSEC007')).toBeDefined();
  });
});

describe('PHP – weak hash (PHPSEC008)', () => {
  it('flags md5()', () => {
    const r = scan('php', `$hash = md5($password);`);
    expect(r.findings.find(f => f.id === 'PHPSEC008')).toBeDefined();
  });
});

describe('PHP – extract injection (PHPSEC010)', () => {
  it('flags extract($_POST)', () => {
    const r = scan('php', `extract($_POST);`);
    expect(r.findings.find(f => f.id === 'PHPSEC010')).toBeDefined();
    expect(r.findings.find(f => f.id === 'PHPSEC010')?.severity).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Finding fields – remediation and line numbers
// ---------------------------------------------------------------------------

describe('Finding fields', () => {
  it('includes non-empty remediation text', () => {
    const r = scan('ts', `eval(code);`);
    const f = r.findings.find(f => f.id === 'JSEC001')!;
    expect(f.remediation).toBeTruthy();
    expect(f.remediation.length).toBeGreaterThan(10);
  });

  it('records the correct 1-based line number', () => {
    const r = scan('ts', `const x = 1;\neval(code);`);
    const f = r.findings.find(f => f.id === 'JSEC001')!;
    expect(f.line).toBe(2);
  });

  it('records a non-empty snippet', () => {
    const r = scan('ts', `eval(code);`);
    expect(r.findings.find(f => f.id === 'JSEC001')?.snippet).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// scanFiles batch API
// ---------------------------------------------------------------------------

describe('scanFiles()', () => {
  it('returns one result per input file', () => {
    const results = scanFiles([
      { filePath: '/a.ts', content: `eval(code);` },
      { filePath: '/b.py', content: `os.system("cmd")` },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].language).toBe('typescript');
    expect(results[1].language).toBe('python');
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe('formatSecurityReport()', () => {
  const r = scan('ts', `eval(code);\nconst password = "Actual@Passw0rd!";`);

  it('returns valid JSON for format="json"', () => {
    const json = formatSecurityReport(r, 'json');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('returns markdown with heading for format="markdown"', () => {
    const md = formatSecurityReport(r, 'markdown');
    expect(md).toContain('# Security Scan Report');
  });

  it('returns text with [HIGH] label for format="text"', () => {
    const text = formatSecurityReport(r, 'text');
    expect(text).toContain('[HIGH]');
  });
});

// ---------------------------------------------------------------------------
// SecurityScanner class
// ---------------------------------------------------------------------------

describe('SecurityScanner', () => {
  it('scan() returns same result as scanFile()', () => {
    const src = `eval(code);`;
    const direct = scanFile('/fixture/file.ts', src);
    const cls = SecurityScanner.scan('/fixture/file.ts', src);
    expect(cls.findings.length).toBe(direct.findings.length);
    expect(cls.summary).toEqual(direct.summary);
  });

  it('format() delegates to formatSecurityReport()', () => {
    const r = scan('ts', `eval(code);`);
    expect(SecurityScanner.format(r, 'json')).toContain('"findings"');
  });

  it('filterBySeverity() returns only findings at or above threshold', () => {
    const r = scan('ts', [
      `const password = "ActualPass!99";`,  // critical
      `document.write(data);`,               // medium
    ].join('\n'));
    const higherOnly = SecurityScanner.filterBySeverity(r, 'high');
    expect(higherOnly.every(f => ['critical', 'high'].includes(f.severity))).toBe(true);
  });
});


