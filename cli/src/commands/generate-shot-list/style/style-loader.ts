/**
 * Style Module Loader
 * 
 * Loads cinematic style modules from augment-extensions
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { StyleLoader, StyleModule, StyleGuidelines } from './types';
import { GuidelineParser } from './guideline-parser';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

/**
 * Style loader implementation
 */
export class CinematicStyleLoader implements StyleLoader {
  private extensionsRoot: string;
  private parser: GuidelineParser;
  
  constructor(extensionsRoot?: string) {
    // Default to augment-extensions directory
    this.extensionsRoot = extensionsRoot || path.join(process.cwd(), 'augment-extensions');
    this.parser = new GuidelineParser();
  }
  
  /**
   * Load a style module from path
   */
  async loadStyle(modulePath: string): Promise<StyleModule> {
    // Validate path
    const isValid = await this.validateStylePath(modulePath);
    if (!isValid) {
      throw new Error(`Invalid style module path: ${modulePath}`);
    }
    
    // Parse module path: writing-standards/screenplay/cinematic-styles/[category]/[style-name]
    const parts = modulePath.split('/');
    const category = parts[parts.length - 2] as StyleModule['category'];
    const styleName = parts[parts.length - 1];
    
    // Load module.json
    const moduleJsonPath = path.join(this.extensionsRoot, modulePath, 'module.json');
    let moduleJson: any;
    try {
      const content = await readFile(moduleJsonPath, 'utf-8');
      moduleJson = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load module.json: ${moduleJsonPath}`);
    }
    
    // Load guidelines from rules/ directory
    const rulesDir = path.join(this.extensionsRoot, modulePath, 'rules');
    const guidelines = await this.loadGuidelines(rulesDir);
    
    return {
      id: moduleJson.name || styleName,
      name: moduleJson.displayName || styleName,
      category,
      path: modulePath,
      guidelines,
      priority: 1  // Will be set by caller
    };
  }
  
  /**
   * Load guidelines from rules directory
   */
  private async loadGuidelines(rulesDir: string): Promise<StyleGuidelines> {
    try {
      const files = await readdir(rulesDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      
      if (mdFiles.length === 0) {
        throw new Error(`No markdown files found in ${rulesDir}`);
      }
      
      // Read all markdown files and merge guidelines
      let allContent = '';
      for (const file of mdFiles) {
        const filePath = path.join(rulesDir, file);
        const content = await readFile(filePath, 'utf-8');
        allContent += content + '\n\n';
      }
      
      // Parse guidelines from combined content
      return this.parser.parseGuidelines(allContent);
    } catch (error) {
      throw new Error(`Failed to load guidelines from ${rulesDir}: ${error}`);
    }
  }
  
  /**
   * Validate a style module path
   */
  async validateStylePath(modulePath: string): Promise<boolean> {
    try {
      // Check if path starts with expected prefix
      if (!modulePath.startsWith('writing-standards/screenplay/cinematic-styles/')) {
        return false;
      }

      // Check if directory exists
      const fullPath = path.join(this.extensionsRoot, modulePath);
      await access(fullPath, fs.constants.R_OK);

      // Check if module.json exists
      const moduleJsonPath = path.join(fullPath, 'module.json');
      await access(moduleJsonPath, fs.constants.R_OK);

      // Check if rules/ directory exists
      const rulesDir = path.join(fullPath, 'rules');
      await access(rulesDir, fs.constants.R_OK);
      const rulesStat = await stat(rulesDir);
      if (!rulesStat.isDirectory()) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Get available styles in a category
   */
  async getAvailableStyles(category: string): Promise<string[]> {
    const categoryPath = path.join(
      this.extensionsRoot,
      'writing-standards/screenplay/cinematic-styles',
      category
    );
    
    try {
      const entries = await readdir(categoryPath, { withFileTypes: true });
      const styles: string[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          const modulePath = `writing-standards/screenplay/cinematic-styles/${category}/${entry.name}`;
          const isValid = await this.validateStylePath(modulePath);
          if (isValid) {
            styles.push(entry.name);
          }
        }
      }
      
      return styles.sort();
    } catch {
      return [];
    }
  }
}

/**
 * Create a style loader
 */
export function createStyleLoader(extensionsRoot?: string): StyleLoader {
  return new CinematicStyleLoader(extensionsRoot);
}

