/**
 * Mock for chalk library (ESM compatibility for Jest)
 *
 * Provides a chainable mock that returns the input string without ANSI codes
 * for testing purposes.  Supports arbitrary chaining depth, e.g. chalk.bold.blue('x').
 */

function makeChainable() {
  // Create a function that just returns its first argument (the string to style).
  const fn = (...args) => args[0] ?? '';

  // Use a Proxy so ANY property access on fn or on a nested result returns
  // another chainable function, enabling chalk.bold.blue('x') etc.
  const proxy = new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'default') return proxy;
      // Return a new chainable so callers can keep chaining or call directly.
      return makeChainable();
    },
    apply(_target, _thisArg, args) {
      return args[0] ?? '';
    },
  });

  return proxy;
}

const chalk = makeChainable();

module.exports = chalk;
module.exports.default = chalk;

