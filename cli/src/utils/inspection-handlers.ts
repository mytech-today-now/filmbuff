/**
 * Custom Inspection Handlers
 * Provides extensible handlers for different module types
 */

import { InspectionHandler } from './plugin-system';
import { Module } from './module-system';
import { contentInspector } from './content-inspector';

/**
 * Handler options interface
 */
export interface HandlerOptions {
  format?: 'text' | 'json' | 'markdown';
  depth?: number;
  filter?: string;
  search?: string;
  [key: string]: any;
}

/**
 * Handler result interface
 */
export interface HandlerResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    handlerId: string;
    moduleType: string;
    processingTime?: number;
  };
}

/**
 * Base inspection handler
 */
export abstract class BaseInspectionHandler implements InspectionHandler {
  abstract id: string;
  abstract supportedTypes: string[];
  priority: number = 0;

  /**
   * Handle module inspection
   */
  abstract handle(module: Module, options: HandlerOptions): Promise<HandlerResult> | HandlerResult;

  /**
   * Check if this handler supports the module type
   */
  supports(moduleType: string): boolean {
    return this.supportedTypes.includes(moduleType);
  }
}

/**
 * Default handler for all module types
 */
export class DefaultInspectionHandler extends BaseInspectionHandler {
  id = 'default-handler';
  supportedTypes = ['*'];
  priority = -1; // Lowest priority

  async handle(module: Module, options: HandlerOptions): Promise<HandlerResult> {
    const startTime = Date.now();

    try {
      const result = {
        module: module.fullName,
        type: module.metadata.type,
        version: module.metadata.version,
        description: module.metadata.description,
        rules: module.rules,
        examples: module.examples
      };

      return {
        success: true,
        data: result,
        metadata: {
          handlerId: this.id,
          moduleType: module.metadata.type,
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          handlerId: this.id,
          moduleType: module.metadata.type,
          processingTime: Date.now() - startTime
        }
      };
    }
  }
}

/**
 * Workflow module handler
 */
export class WorkflowInspectionHandler extends BaseInspectionHandler {
  id = 'workflow-handler';
  supportedTypes = ['workflows'];
  priority = 10;

  async handle(module: Module, options: HandlerOptions): Promise<HandlerResult> {
    const startTime = Date.now();

    try {
      // Workflow-specific inspection logic
      const result = {
        module: module.fullName,
        type: 'workflow',
        version: module.metadata.version,
        description: module.metadata.description,
        workflowSteps: this.extractWorkflowSteps(module),
        rules: module.rules,
        examples: module.examples
      };

      return {
        success: true,
        data: result,
        metadata: {
          handlerId: this.id,
          moduleType: module.metadata.type,
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          handlerId: this.id,
          moduleType: module.metadata.type,
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  private extractWorkflowSteps(module: Module): string[] {
    // Extract numbered / bulleted steps from rule markdown files in the module.
    // Looks for lines matching "1. …", "- Step:", or "## Step N" patterns.
    const steps: string[] = [];
    for (const rule of module.rules ?? []) {
      const content: string = typeof rule === 'string' ? rule : (rule as any).content ?? '';
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Numbered list step: "1. Do something"
        const numbered = trimmed.match(/^(\d+)\.\s+(.+)/);
        if (numbered) { steps.push(numbered[2].trim()); continue; }
        // Heading step: "## Step 1: …" or "### Step …"
        const heading = trimmed.match(/^#{1,4}\s+(?:Step\s+\d+[:.]?\s*)?(.+)/i);
        if (heading && /step/i.test(trimmed)) { steps.push(heading[1].trim()); }
      }
    }
    return steps;
  }
}

/**
 * Coding standards handler
 */
export class CodingStandardsHandler extends BaseInspectionHandler {
  id = 'coding-standards-handler';
  supportedTypes = ['coding-standards'];
  priority = 10;

  async handle(module: Module, options: HandlerOptions): Promise<HandlerResult> {
    const startTime = Date.now();

    try {
      const result = {
        module: module.fullName,
        type: 'coding-standards',
        version: module.metadata.version,
        description: module.metadata.description,
        standards: this.extractStandards(module),
        rules: module.rules,
        examples: module.examples
      };

      return {
        success: true,
        data: result,
        metadata: {
          handlerId: this.id,
          moduleType: module.metadata.type,
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          handlerId: this.id,
          moduleType: module.metadata.type,
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  private extractStandards(module: Module): string[] {
    // Extract coding standard rules (bold/emphasized lines and list items) from rule files.
    const standards: string[] = [];
    for (const rule of module.rules ?? []) {
      const content: string = typeof rule === 'string' ? rule : (rule as any).content ?? '';
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Bold standard rule: "**MUST** use semicolons"
        const bold = trimmed.match(/\*\*([^*]+)\*\*\s+(.+)/);
        if (bold) { standards.push(`${bold[1]}: ${bold[2].trim()}`); continue; }
        // List item standard: "- Always foo" / "* Never bar"
        const listItem = trimmed.match(/^[-*]\s+(?:Always|Never|Must|Should|Do not|MUST|SHOULD)\s+.+/i);
        if (listItem) standards.push(trimmed.replace(/^[-*]\s+/, ''));
      }
    }
    return standards;
  }
}

