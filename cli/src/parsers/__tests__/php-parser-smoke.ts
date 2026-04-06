/**
 * Smoke tests for PhpParser – validates core extraction functionality.
 * Run with: npx tsx cli/src/parsers/__tests__/php-parser-smoke.ts
 */

import { parsePhp, PhpInspectionMetadata } from '../php-parser.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CLASS_WITH_NAMESPACE = `<?php
declare(strict_types=1);

namespace App\\Services;

use App\\Contracts\\UserRepository;
use Psr\\Log\\LoggerInterface;

/**
 * User service managing user operations.
 * @deprecated Use UserManager instead
 */
class UserService
{
    private string $name = 'default';

    public static int $count = 0;

    const VERSION = '1.0.0';
    public const MAX_USERS = 100;

    /**
     * Find user by ID.
     * @param int $id User identifier.
     * @return User|null
     * @throws NotFoundException When not found.
     */
    public function findById(int $id): ?User
    {
        return null;
    }

    protected static function validate(array $data): bool
    {
        return !empty($data);
    }
}
`;

const INTERFACE_AND_TRAIT = `<?php
namespace App\\Contracts;

interface Countable
{
    public function count(): int;
}

trait Loggable
{
    abstract protected function log(string $message): void;
}
`;

const TOP_LEVEL_FUNCTIONS = `<?php
namespace App\\Helpers;

function helperFn(string $msg, int $count = 0): void {}

define('APP_VERSION', '2.0.0');
const DB_PORT = 5432;
`;

const SYNTAX_ERROR_CONTENT = `<?php
namespace Broken;
// Intentionally unclosed class to stress error handling
class BrokenClass {
    public function brokenMethod(
`;

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: Class with namespace, PHPDoc, methods, properties, constants
// ---------------------------------------------------------------------------
console.log('\nTest 1: class with namespace, PHPDoc, methods, properties, constants');
{
  const r = parsePhp(CLASS_WITH_NAMESPACE, 'UserService.php');

  assert('language is php', r.language === 'php');
  assert('strictTypes true', r.metadata.strictTypes === true);
  assert('psr4Compliant true', r.metadata.psr4Compliant === true);
  assert('namespace extracted', r.namespaces.length === 1 && r.namespaces[0].name === 'App\\Services');
  assert('uses count', r.uses.length === 2);
  assert('class extracted', r.classes.length === 1 && r.classes[0].name === 'UserService');
  assert('class kind is class', r.classes[0].kind === 'class');

  const cls = r.classes[0];
  assert('class docComment description', (cls.docComment?.description ?? '').includes('User service'));
  assert('class docComment deprecated', cls.docComment?.deprecated === true);
  assert('class constants', cls.constants.some(c => c.name === 'VERSION'));
  assert('class public const', cls.constants.some(c => c.name === 'MAX_USERS'));
  assert('class properties', cls.properties.some(p => p.name === '$name' || p.name.includes('name')));
  assert('findById method exists', cls.methods.some(m => m.name === 'findById'));

  const findById = cls.methods.find(m => m.name === 'findById');
  assert('findById returnType', findById?.returnType === '?User');
  assert('findById param', findById?.params.some(p => p.name === '$id') === true);
  assert('findById docComment throws', (findById?.docComment?.throws ?? []).includes('NotFoundException'));
  assert('validate method isStatic', cls.methods.find(m => m.name === 'validate')?.isStatic === true);
  assert('no top-level errors', r.errors.length === 0);
}

// ---------------------------------------------------------------------------
// Test 2: Interface and trait
// ---------------------------------------------------------------------------
console.log('\nTest 2: interface and trait');
{
  const r = parsePhp(INTERFACE_AND_TRAIT, 'Countable.php');

  assert('namespace', r.namespaces[0]?.name === 'App\\Contracts');
  assert('interface extracted', r.classes.some(c => c.name === 'Countable' && c.kind === 'interface'));
  assert('trait extracted', r.classes.some(c => c.name === 'Loggable' && c.kind === 'trait'));
  assert('count method on interface', r.classes.find(c => c.name === 'Countable')?.methods.some(m => m.name === 'count') === true);
}

// ---------------------------------------------------------------------------
// Test 3: Top-level functions, define(), const
// ---------------------------------------------------------------------------
console.log('\nTest 3: top-level functions, define(), const');
{
  const r = parsePhp(TOP_LEVEL_FUNCTIONS, 'helpers.php');

  assert('helperFn extracted', r.functions.some(f => f.name === 'helperFn'));
  assert('define constant', r.constants.some(c => c.name === 'APP_VERSION'));
  assert('const keyword constant', r.constants.some(c => c.name === 'DB_PORT'));

  const fn = r.functions.find(f => f.name === 'helperFn');
  assert('helperFn params count', fn?.params.length === 2);
  assert('helperFn param with default', fn?.params.some(p => p.name === '$count' && p.defaultValue === '0') === true);
}

// ---------------------------------------------------------------------------
// Test 4: Graceful handling of syntax errors
// ---------------------------------------------------------------------------
console.log('\nTest 4: graceful handling of syntax / structural errors');
{
  const r = parsePhp(SYNTAX_ERROR_CONTENT, 'BrokenClass.php');
  // Parser should not throw; should return a result (possibly with partial data)
  assert('returns result object', r !== null && typeof r === 'object');
  assert('language still php', r.language === 'php');
  assert('namespace still extracted', r.namespaces.some(n => n.name === 'Broken'));
  assert('class still extracted', r.classes.some(c => c.name === 'BrokenClass'));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
