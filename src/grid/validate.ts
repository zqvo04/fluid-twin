/**
 * Grid-level diagnostics: compile issues (dangling ports, isolated tiles)
 * plus the existing network-level checks (no reservoir, size mismatches at
 * a junction) — reused as-is since they operate on the compiled
 * PipelineNetwork and don't care that it came from a grid.
 */

import { validateNetwork, ValidationIssue } from '../domain/network';
import { checkConnectors } from '../domain/connectivity';
import { GridModel } from './types';
import { compile } from './compile';

export function validateGrid(grid: GridModel): ValidationIssue[] {
  const { network, issues } = compile(grid);
  return [...issues, ...validateNetwork(network), ...checkConnectors(network)];
}
