'use strict';

// Simulate the RunLogger scenario: sonic-boom is loaded and instantiated
// BEFORE we apply the patch (which is what happens in the CLI).
const sb = require('sonic-boom');
const dest = new sb({ fd: 1 });

// Now patch, as RunLogger.start() does:
const myFs = require('fs');
const orig = myFs.write;
let hit = 0;

myFs.write = function (fd, b, ...a) {
  if (fd === 1) {
    hit++;
    process.stderr.write('fs.write intercepted fd=1 buf-type=' + typeof b + '\n');
  }
  return orig.call(this, fd, b, ...a);
};

// Write after patching
dest.write('hello sonic (post-patch)\n');
dest.flush();

setTimeout(() => {
  myFs.write = orig;
  process.stderr.write('total hits: ' + hit + '\n');
}, 300);
