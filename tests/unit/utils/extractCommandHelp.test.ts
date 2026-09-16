import * as fs from 'fs';
import packageJson from '../../../package.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectTools,
  detectSubcommands,
  generateMarkdown,
  extractHelpRecursive,
  Tool,
  HelpNode
} from '@cli/utils/extractCommandHelp';

const packageVersion = (packageJson as { version: string }).version;
let helpByCommand: Record<string, string> = {};
let seenCommands: string[] = [];

vi.mock('child_process', () => ({
  exec: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')](command: string) {
      const stdout = helpByCommand[command];

      seenCommands.push(command);

      if (stdout === undefined) {
        throw new Error(`Unexpected help command: ${command}`);
      }

      return Promise.resolve({ stdout, stderr: '' });
    }
  })
}));

vi.mock('fs', () => ({
  existsSync: vi.fn()
}));

describe('extractCommandHelp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectTools', () => {
    it('should detect tools when directories exist', () => {
      const repoRoot = '/test/repo';
      const tools: Tool[] = [
        { name: 'Beads', command: 'bd', directory: '.beads' },
        { name: 'OpenSpec', command: 'openspec', directory: 'openspec' }
      ];

      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return pathStr.includes('.beads') || pathStr.includes('openspec');
      });

      const result = detectTools(repoRoot, tools);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Beads');
      expect(result[1].name).toBe('OpenSpec');
    });

    it('should return empty array when no tools detected', () => {
      const repoRoot = '/test/repo';
      const tools: Tool[] = [
        { name: 'Beads', command: 'bd', directory: '.beads' }
      ];

      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = detectTools(repoRoot, tools);

      expect(result).toHaveLength(0);
    });

    it('should only detect tools with existing directories', () => {
      const repoRoot = '/test/repo';
      const tools: Tool[] = [
        { name: 'Beads', command: 'bd', directory: '.beads' },
        { name: 'OpenSpec', command: 'openspec', directory: 'openspec' },
        { name: 'Augx', command: 'augx', directory: '.augment' }
      ];

      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        return p.toString().includes('.beads');
      });

      const result = detectTools(repoRoot, tools);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Beads');
    });
  });

  describe('detectSubcommands', () => {
    it('should detect subcommands from "Commands:" section', () => {
      const helpText = `
Usage: bd [command]

Commands:
  create    Create a new issue
  list      List all issues
  update    Update an issue
  close     Close an issue

Options:
  --help    Show help
`;

      const result = detectSubcommands(helpText);

      expect(result).toEqual(['close', 'create', 'list', 'update']);
    });

    it('should detect hyphenated subcommands from "Commands:" section', () => {
      const helpText = `
Usage: tool [command]

Commands:
  generate-video  Generate a video
  check-updates   Check for updates
  mcp-server      Start the MCP server

Options:
  --help    Show help
`;

      const result = detectSubcommands(helpText);

      expect(result).toEqual(['check-updates', 'generate-video', 'mcp-server']);
    });

    it('should detect subcommands from "Available commands:" section', () => {
      const helpText = `
Available commands:
  init      Initialize project
  sync      Sync changes
  status    Show status
`;

      const result = detectSubcommands(helpText);

      expect(result).toEqual(['init', 'status', 'sync']);
    });

    it('should detect subcommands from Usage pattern', () => {
      const helpText = `Usage: tool {create|list|update|delete}`;

      const result = detectSubcommands(helpText);

      expect(result).toContain('create');
      expect(result).toContain('list');
      expect(result).toContain('update');
      expect(result).toContain('delete');
    });

    it('should detect hyphenated subcommands from Usage pattern', () => {
      const helpText = `Usage: tool {generate-video|check-updates|mcp-server}`;

      const result = detectSubcommands(helpText);

      expect(result).toEqual(['check-updates', 'generate-video', 'mcp-server']);
    });

    it('should return empty array when no subcommands found', () => {
      const helpText = `
This is a simple tool with no subcommands.

Options:
  --help    Show help
  --version Show version
`;

      const result = detectSubcommands(helpText);

      expect(result).toEqual([]);
    });

    it('should handle multiple patterns and deduplicate', () => {
      const helpText = `
Usage: bd {create|list}

Commands:
  create    Create a new issue
  list      List all issues
  update    Update an issue
`;

      const result = detectSubcommands(helpText);

      expect(result).toEqual(['create', 'list', 'update']);
    });
  });

  describe('generateMarkdown', () => {
    it('should generate valid Markdown from help map', () => {
      const helpMap = new Map<Tool, HelpNode>();
      const tool: Tool = { name: 'Beads', command: 'bd', directory: '.beads' };
      const helpNode: HelpNode = {
        command: 'bd',
        help: 'Beads task management tool',
        children: [
          {
            command: 'bd create',
            help: 'Create a new issue',
            children: []
          }
        ]
      };

      helpMap.set(tool, helpNode);

      const result = generateMarkdown(helpMap, packageVersion);

      expect(result).toContain('# Command Help Reference');
      expect(result).toContain('## Beads Commands (bd)');
      expect(result).toContain('### bd --help');
      expect(result).toContain('Beads task management tool');
      expect(result).toContain('#### bd create --help');
      expect(result).toContain('Create a new issue');
    });

    it('should handle multiple tools', () => {
      const helpMap = new Map<Tool, HelpNode>();

      const tool1: Tool = { name: 'Beads', command: 'bd', directory: '.beads' };
      const helpNode1: HelpNode = {
        command: 'bd',
        help: 'Beads tool',
        children: []
      };

      const tool2: Tool = { name: 'filmbuff', command: 'filmbuff', directory: '.augment' };
      const helpNode2: HelpNode = {
        command: 'filmbuff',
        help: 'filmbuff tool',
        children: []
      };

      helpMap.set(tool1, helpNode1);
      helpMap.set(tool2, helpNode2);

      const result = generateMarkdown(helpMap, packageVersion);

      expect(result).toContain('## filmbuff Commands (filmbuff)');
      expect(result).toContain('## Beads Commands (bd)');
      expect(result).toContain('**Tools**: Beads, filmbuff');
    });

    it('should handle empty help map', () => {
      const helpMap = new Map<Tool, HelpNode>();

      const result = generateMarkdown(helpMap, packageVersion);

      expect(result).toContain('# Command Help Reference');
      expect(result).toContain('**Tools**: ');
    });

    it('should include timestamp and version', () => {
      const helpMap = new Map<Tool, HelpNode>();
      const tool: Tool = { name: 'Test', command: 'test', directory: '.test' };
      const helpNode: HelpNode = { command: 'test', help: 'Test tool', children: [] };
      helpMap.set(tool, helpNode);

      const result = generateMarkdown(helpMap, packageVersion);

      expect(result).toContain('**Generated**:');
      expect(result).toContain(`**Version**: ${packageVersion}`);
    });

    it('should format nested subcommands correctly', () => {
      const helpMap = new Map<Tool, HelpNode>();
      const tool: Tool = { name: 'Test', command: 'test', directory: '.test' };
      const helpNode: HelpNode = {
        command: 'test',
        help: 'Root help',
        children: [
          {
            command: 'test sub1',
            help: 'Sub1 help',
            children: [
              {
                command: 'test sub1 subsub1',
                help: 'SubSub1 help',
                children: []
              }
            ]
          }
        ]
      };

      helpMap.set(tool, helpNode);

      const result = generateMarkdown(helpMap, packageVersion);

      expect(result).toContain('### test --help');
      expect(result).toContain('#### test sub1 --help');
      expect(result).toContain('##### test sub1 subsub1 --help');
    });
  });

  describe('extractHelpRecursive', () => {
    it('should keep hyphenated nested subcommands visible in the recursive help output', async () => {
      helpByCommand = {
        'filmbuff --help': `
Usage: filmbuff [command]

Commands:
  generate-video  Generate a video pipeline
  mcp-server      Start the MCP tool server

Options:
  --help    Show help
`,
        'filmbuff generate-video --help': `
Usage: filmbuff generate-video [command]

Commands:
  check-updates  Check for updates

Options:
  --help    Show help
`,
        'filmbuff generate-video check-updates --help': `
Usage: filmbuff generate-video check-updates

Options:
  --help    Show help
`,
        'filmbuff mcp-server --help': `
Usage: filmbuff mcp-server

Options:
  --help    Show help
`,
      };
      seenCommands = [];

      const helpNode = await extractHelpRecursive('filmbuff');

      expect(helpNode.command).toBe('filmbuff');
      expect(helpNode.children).toHaveLength(2);
      expect(helpNode.children.map(child => child.command)).toEqual([
        'filmbuff generate-video',
        'filmbuff mcp-server'
      ]);
      expect(helpNode.children[0].children.map(child => child.command)).toEqual([
        'filmbuff generate-video check-updates'
      ]);
      expect(seenCommands[0]).toBe('filmbuff --help');
      expect(seenCommands).toHaveLength(4);
      expect(seenCommands).toEqual(expect.arrayContaining([
        'filmbuff --help',
        'filmbuff generate-video --help',
        'filmbuff generate-video check-updates --help',
        'filmbuff mcp-server --help'
      ]));

      const helpMap = new Map<Tool, HelpNode>();
      helpMap.set(
        { name: 'filmbuff', command: 'filmbuff', directory: '.augment' },
        helpNode
      );

      const markdown = generateMarkdown(helpMap, packageVersion);

      expect(markdown).toContain('## filmbuff Commands (filmbuff)');
      expect(markdown).toContain('### filmbuff --help');
      expect(markdown).toContain('#### filmbuff generate-video --help');
      expect(markdown).toContain('##### filmbuff generate-video check-updates --help');
      expect(markdown).toContain('#### filmbuff mcp-server --help');
    });
  });

  describe('edge cases', () => {
    it('should handle tools with custom help flags', () => {
      const tools: Tool[] = [
        { name: 'Custom', command: 'custom', directory: '.custom', helpFlag: '-h' }
      ];

      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = detectTools('/test', tools);

      expect(result[0].helpFlag).toBe('-h');
    });

    it('should handle empty help text', () => {
      const result = detectSubcommands('');

      expect(result).toEqual([]);
    });

    it('should handle malformed help text', () => {
      const helpText = 'This is not valid help text with no structure';

      const result = detectSubcommands(helpText);

      expect(result).toEqual([]);
    });
  });
});
